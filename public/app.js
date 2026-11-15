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
let _gisScriptPromise = null;
let _gisInitializedClientId = null;
let _googleSignInInFlight = false;

function isProductionBackendConfigured() {
  return Boolean(getNightMerchantApiBaseUrl());
}

function getEffectiveGoogleClientId() {
  const cfg = getNightMerchantRuntimeConfig();
  const runtimeVal =
    typeof appState !== "undefined" && appState && typeof appState.googleClientId === "string"
      ? appState.googleClientId
      : "";
  const cfgVal = cfg && typeof cfg.googleClientId === "string" ? cfg.googleClientId : "";
  return (runtimeVal || cfgVal).replace(/^[<>"'\s]+|[<>"'\s]+$/g, "");
}

function isLikelySafariBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = String(navigator.userAgent || "");
  return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg|OPR|Android/i.test(ua);
}

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

async function setBestFirebasePersistence(auth, authMod, skipIndexedDb = false) {
  if (!auth || !authMod || typeof authMod.setPersistence !== "function") return null;
  const candidates = skipIndexedDb
    ? [authMod.browserLocalPersistence, authMod.browserSessionPersistence, authMod.inMemoryPersistence]
    : [
        authMod.indexedDBLocalPersistence,
        authMod.browserLocalPersistence,
        authMod.browserSessionPersistence,
        authMod.inMemoryPersistence,
      ];
  for (const persistence of candidates) {
    if (!persistence) continue;
    try {
      await authMod.setPersistence(auth, persistence);
      return persistence;
    } catch (_persistErr) {}
  }
  return null;
}

function isStoragePersistenceError(err) {
  const code = String((err && err.code) || "").toLowerCase();
  const msg = String((err && err.message) || "").toLowerCase();
  return (
    code.includes("web-storage-unsupported") ||
    msg.includes("indexeddb") ||
    msg.includes("sessionstorage") ||
    msg.includes("localstorage") ||
    msg.includes("quota") ||
    msg.includes("storage")
  );
}

async function runFirebaseAuthOpWithPersistenceFallback(auth, authMod, authOp) {
  try {
    return await authOp(auth);
  } catch (err) {
    if (!isStoragePersistenceError(err)) {
      throw err;
    }
    await setBestFirebasePersistence(auth, authMod, true);
    return authOp(auth);
  }
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
      await setBestFirebasePersistence(auth, authMod, false);
      if (typeof auth.authStateReady === "function") {
        await auth.authStateReady();
      }
      _fbAuthModule = authMod;
      _fbAuthInstance = auth;
      return auth;
    } catch (err) {
      console.error("[NightMerchant] Firebase client init failed.");
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
  const cred = await runFirebaseAuthOpWithPersistenceFallback(auth, _fbAuthModule, (a) =>
    _fbAuthModule.signInWithCustomToken(a, customToken)
  );
  return cred && cred.user ? cred.user.getIdToken() : null;
}

async function signInWithFirebaseEmailPassword(email, password) {
  if (!email || !password || !isFirebaseClientConfigured()) return null;
  const auth = await initFirebaseClientIfConfigured();
  if (!auth || !_fbAuthModule || typeof _fbAuthModule.signInWithEmailAndPassword !== "function") return null;
  try {
    const cred = await runFirebaseAuthOpWithPersistenceFallback(auth, _fbAuthModule, (a) =>
      _fbAuthModule.signInWithEmailAndPassword(a, email, password)
    );
    return cred && cred.user ? cred.user.getIdToken() : null;
  } catch (_err) {
    return null;
  }
}

async function signInWithFirebaseGoogleCredential(googleIdToken) {
  if (!googleIdToken || !isFirebaseClientConfigured()) return null;
  const auth = await initFirebaseClientIfConfigured();
  if (
    !auth ||
    !_fbAuthModule ||
    !_fbAuthModule.GoogleAuthProvider ||
    typeof _fbAuthModule.GoogleAuthProvider.credential !== "function" ||
    typeof _fbAuthModule.signInWithCredential !== "function"
  ) {
    return null;
  }
  const oauthCred = _fbAuthModule.GoogleAuthProvider.credential(googleIdToken);
  const cred = await runFirebaseAuthOpWithPersistenceFallback(auth, _fbAuthModule, (a) =>
    _fbAuthModule.signInWithCredential(a, oauthCred)
  );
  return cred && cred.user ? cred.user.getIdToken() : null;
}

function signInWithFirebaseGooglePopup() {
  // Call signInWithPopup synchronously when Firebase Auth is already initialized
  // so Safari preserves the click user-gesture context for window.open.
  if (_fbAuthInstance && _fbAuthModule) {
    const provider = new _fbAuthModule.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return _fbAuthModule.signInWithPopup(_fbAuthInstance, provider).then((cred) => {
      if (!cred || !cred.user) {
        throw new Error("Google sign-in did not return a user credential.");
      }
      return cred.user.getIdToken();
    });
  }
  return initFirebaseClientIfConfigured().then(async (auth) => {
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
  });
}

function loadGoogleIdentityServices() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(null);
  }
  if (window.google && window.google.accounts && window.google.accounts.id) {
    return Promise.resolve(window.google.accounts.id);
  }
  if (_gisScriptPromise) return _gisScriptPromise;

  _gisScriptPromise = new Promise((resolve) => {
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    const done = () => {
      if (window.google && window.google.accounts && window.google.accounts.id) {
        resolve(window.google.accounts.id);
      } else {
        _gisScriptPromise = null;
        resolve(null);
      }
    };
    if (existing) {
      if (existing.dataset.nmLoaded === "1") {
        done();
        return;
      }
      existing.addEventListener("load", done, { once: true });
      existing.addEventListener("error", () => {
        _gisScriptPromise = null;
        resolve(null);
      }, { once: true });
      return;
    }

    const script = document.createElement("script");
    // Google Identity Services uses a rolling unversioned loader URL (SRI omitted per Google GIS guidance).
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.referrerPolicy = "strict-origin-when-cross-origin";
    const timer = window.setTimeout(() => {
      _gisScriptPromise = null;
      resolve(null);
    }, 8000);
    script.addEventListener("load", () => {
      window.clearTimeout(timer);
      script.dataset.nmLoaded = "1";
      done();
    }, { once: true });
    script.addEventListener("error", () => {
      window.clearTimeout(timer);
      _gisScriptPromise = null;
      resolve(null);
    }, { once: true });
    document.head.appendChild(script);
  });

  return _gisScriptPromise;
}

async function signOutFirebaseClient() {
  if (
    typeof window !== "undefined" &&
    window.google &&
    window.google.accounts &&
    window.google.accounts.id &&
    typeof window.google.accounts.id.disableAutoSelect === "function"
  ) {
    try {
      window.google.accounts.id.disableAutoSelect();
    } catch (_gisErr) {}
  }
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

const ROME_NEIGHBORHOOD_HISTORIES = {
  A1: "Cylindrical imperial mausoleum erected by Hadrian beside the Tiber; in February 211 A.D. Septimius Severus's ashes were newly interred here beside Antonine emperors across the Pons Aelius.",
  B1: "Grand northern trunk road entering Rome toward the Campus Martius, crowded with marble tombs, wayside inns, and nocturnal supply wagons rolling in from Umbria and Etruria.",
  C1: "The 'Hill of Gardens' along Rome's northern bluff, dotted with terraced senatorial villas, cypress groves, and overlooking loggias prized by wealthy Roman families.",
  D1: "Opulent imperial pleasure gardens framed by gilded porticos north of the Quirinal, originally laid out by historian Sallust and favored as a secluded retreat by the Severan court.",
  E1: "Northeastern road skirting the outer estates past vineyards and villas toward Sabini territory, heavily watched by night patrols from the adjacent Praetorian fortress.",
  F1: "Fortified red-brick garrison housing the elite Praetorian Guard; in 211 A.D. the rival courts of Caracalla and Geta both court its cohorts' decisive loyalty.",
  A2: "Domitian's monumental stone stadium in the western Campus Martius hosting footraces, Greek athletics, and evening crowds beneath tiered travertine arcades.",
  B2: "Expansive public bathhouse rebuilt beside Agrippa's Pantheon, humming at dusk with bathers, oiled wrestlers, lamp-lit wine stalls, and senators trading gossip.",
  C2: "Monumental marble portico east of the Pantheon where tribal citizens once voted; by 211 A.D. it thrives as a prestigious covered arcade for luxury goods, books, and livestock.",
  D2: "High ancient northern ridge of Sabine origins crowned by noble domus residences, sanctuaries of Quirinus, and steep brick insulae overlooking the central valleys.",
  E2: "Rome's loudest, densest lower-valley quarter — a maze of tall wooden tenements, cookshops, cobbler stalls, wine taverns, and furtive alleys beneath the Viminal slope.",
  F2: "Narrow ridge between the Quirinal and Esquiline lined with brick workshops, neighborhood bathhouses, and the ancient earthen Agger defense rampart.",
  A3: "Rome's first permanent stone theater and sprawling garden portico where Julius Caesar fell; gleaming after Severan restorations with nocturnal mimes and theatrical spectacles.",
  B3: "Historic Campus Martius square ringed by triumphal temples and colonnades, famous for ceremonial processions, cattle markets, and bustling evening trade fairs.",
  C3: "Grandest of the Imperial Fora, anchored by Trajan's sculpted Column, Basilica Ulpia, and towering brick Markets distributing imperial grain, oil, and coin.",
  D3: "Luna-marble plaza built by Augustus around the Temple of Mars Ultor, flanked by colonnades of Roman heroes where urban magistrates hear commercial disputes.",
  E3: "Colossal terraced bath complex raised over Nero's buried Golden House on the Oppian Hill, drawing thousands nightly to hot pools, palaestra yards, and colonnades.",
  F3: "Ancient eastern highway descending from the Tibur stone quarries and Anio aqueducts, channeling heavy carts of travertine, timber, and meat into Rome.",
  A4: "Coastal western highway climbing the Janiculum Hill and descending to Trastevere's Tiber wharves, funneling maritime imports and mule trains under night cover.",
  B4: "Working-class quarter west of the Tiber linked via Tiber Island; teeming with river barges, salt quays, foreign merchant colonies, tanneries, and waterside taverns.",
  C4: "Sacred rocky citadel of Rome crowned by the gilt-roofed Temple of Jupiter Optimus Maximus, the Tabularium archives, and steep monumental stairs above the Forum.",
  D4: "Vespasian's serene colonnaded sanctuary housing spoils from Judea and the massive carved marble map of Rome (Forma Urbis) newly updated under Septimius Severus.",
  E4: "The Flavian Amphitheater — four tiers of travertine towering over the valley floor, demanding nonstop shipments of gladiator arms, wild beasts, and spectator provisions.",
  F4: "Broad eastern plateau combining aristocratic villas and leafy horti with lively macellum provision halls and shadowy residential lanes.",
  A5: "Riverside gardens bequeathed to the Roman public by Julius Caesar along lower Trastevere, bordering busy river granaries and timber landings opposite the Emporium.",
  B5: "Southern hill once sacred to Rome's plebeians and now graced by wealthy townhouses, foreign cults, and terraced sanctuaries gazing over the Circus Maximus.",
  C5: "Vast 150,000-seat valley hippodrome separating the Palatine and Aventine hills, ringed outside its arcades by fortune-tellers, tavernkeepers, and racing syndicates.",
  D5: "Crown jewel of imperial palaces overlooking Rome, expanded by Septimius Severus's soaring Septizodium; in 211 A.D. its marble halls simmer with Caracalla and Geta's feud.",
  E5: "Lower slope linking the Subura valley with the Caelian foothills along ancient sacred streets of humble taverns, shrines of the Lares, and late-night artisans.",
  F5: "Small brick court and military amphitheater built in the early 3rd century on the imperial Sessorian estate for guard drills and private wild-beast spectacles.",
  A6: "Tiber port district flanking the massive Horrea Galbae warehouses and Mons Testaceus — an artificial hill formed from millions of shattered olive-oil and wine amphorae.",
  B6: "Major harbor highway from Ostia passing the white marble Pyramid of Cestius, carrying endless wagon convoys of imported grain, salted meat, and Mediterranean wine.",
  C6: "Quieter southern spur of the Aventine scattered with stone workshops, temple precincts of Bona Dea, and winding hillside paths leading toward the southern gates.",
  D6: "Caracalla's colossal new imperial bath project breaking ground along the Via Appia in 211 A.D. — a sprawling construction hub hungry for marble, tools, and provisions.",
  E6: "Eastern forested spur of the Caelian Hill hosting equite townhouses, Cohortes Vigiles fire-watch posts, and terraced cisterns feeding nearby palaces.",
  F6: "Southeastern thoroughfare rising gently toward Tusculum and the Alban vineyards, bringing hill produce, wine casks, and weary cohorts into Rome through the Porta Asinaria.",
};

const TILE_STACK_PROFILES = {
  A1: { topBuys: [{ category: "Marble", count: 7 }, { category: "Fine Wine", count: 4 }, { category: "Weapons", count: 3 }], encounters: { nefarii: 5, patricii: 5, legiones: 9 } },
  A2: { topBuys: [{ category: "Weapons", count: 5 }, { category: "Animals", count: 3 }, { category: "Meat Animals", count: 3 }], encounters: { nefarii: 10, patricii: 4, legiones: 9 } },
  A3: { topBuys: [{ category: "Wine", count: 7 }, { category: "Animals", count: 3 }, { category: "Meat Animals", count: 3 }], encounters: { nefarii: 6, patricii: 6, legiones: 8 } },
  A4: { topBuys: [{ category: "Meat Animals", count: 3 }, { category: "Weapons", count: 3 }, { category: "Cheap Wine", count: 2 }], encounters: { nefarii: 7, patricii: 4, legiones: 8 } },
  A5: { topBuys: [{ category: "Grain", count: 6 }, { category: "Meat Animals", count: 4 }, { category: "Weapons", count: 3 }], encounters: { nefarii: 12, patricii: 5, legiones: 10 } },
  A6: { topBuys: [{ category: "Meat Animals", count: 6 }, { category: "Grain", count: 3 }, { category: "Animals", count: 2 }], encounters: { nefarii: 11, patricii: 5, legiones: 9 } },
  B1: { topBuys: [{ category: "Grain", count: 3 }, { category: "Weapons", count: 3 }, { category: "Meat Animals", count: 2 }], encounters: { nefarii: 10, patricii: 3, legiones: 11 } },
  B2: { topBuys: [{ category: "Marble", count: 4 }, { category: "Wine", count: 4 }, { category: "Animals", count: 3 }], encounters: { nefarii: 15, patricii: 5, legiones: 9 } },
  B3: { topBuys: [{ category: "Animals", count: 3 }, { category: "Weapons", count: 3 }, { category: "Cheap Wine", count: 2 }], encounters: { nefarii: 11, patricii: 4, legiones: 9 } },
  B4: { topBuys: [{ category: "Grain", count: 4 }, { category: "Weapons", count: 4 }, { category: "Animals", count: 2 }], encounters: { nefarii: 7, patricii: 2, legiones: 10 } },
  B5: { topBuys: [{ category: "Marble", count: 4 }, { category: "Fine Wine", count: 3 }, { category: "Grain", count: 3 }], encounters: { nefarii: 11, patricii: 4, legiones: 12 } },
  B6: { topBuys: [{ category: "Grain", count: 2 }, { category: "Marble", count: 2 }, { category: "Meat Animals", count: 2 }], encounters: { nefarii: 7, patricii: 4, legiones: 9 } },
  C1: { topBuys: [{ category: "Grain", count: 3 }, { category: "Meat Animals", count: 2 }, { category: "Weapons", count: 2 }], encounters: { nefarii: 14, patricii: 4, legiones: 11 } },
  C2: { topBuys: [{ category: "Meat Animals", count: 3 }, { category: "Cheap Wine", count: 2 }, { category: "Grain", count: 2 }], encounters: { nefarii: 8, patricii: 5, legiones: 13 } },
  C3: { topBuys: [{ category: "Grain", count: 6 }, { category: "Marble", count: 6 }, { category: "Weapons", count: 5 }], encounters: { nefarii: 5, patricii: 4, legiones: 10 } },
  C4: { topBuys: [{ category: "Grain", count: 3 }, { category: "Marble", count: 3 }, { category: "Meat Animals", count: 3 }], encounters: { nefarii: 9, patricii: 6, legiones: 14 } },
  C5: { topBuys: [{ category: "Grain", count: 3 }, { category: "Animals", count: 2 }, { category: "Exotic Animals", count: 2 }], encounters: { nefarii: 11, patricii: 4, legiones: 12 } },
  C6: { topBuys: [{ category: "Meat Animals", count: 3 }, { category: "Cheap Wine", count: 2 }, { category: "Grain", count: 2 }], encounters: { nefarii: 8, patricii: 5, legiones: 14 } },
  D1: { topBuys: [{ category: "Fine Wine", count: 2 }, { category: "Grain", count: 2 }, { category: "Marble", count: 2 }], encounters: { nefarii: 14, patricii: 4, legiones: 10 } },
  D2: { topBuys: [{ category: "Grain", count: 3 }, { category: "Meat Animals", count: 3 }, { category: "Fine Wine", count: 2 }], encounters: { nefarii: 8, patricii: 5, legiones: 14 } },
  D3: { topBuys: [{ category: "Grain", count: 6 }, { category: "Marble", count: 6 }, { category: "Weapons", count: 5 }], encounters: { nefarii: 5, patricii: 4, legiones: 11 } },
  D4: { topBuys: [{ category: "Grain", count: 6 }, { category: "Marble", count: 6 }, { category: "Weapons", count: 5 }], encounters: { nefarii: 10, patricii: 5, legiones: 9 } },
  D5: { topBuys: [{ category: "Fine Wine", count: 4 }, { category: "Marble", count: 3 }, { category: "Meat Animals", count: 3 }], encounters: { nefarii: 8, patricii: 6, legiones: 14 } },
  D6: { topBuys: [{ category: "Marble", count: 4 }, { category: "Fine Wine", count: 2 }, { category: "Grain", count: 2 }], encounters: { nefarii: 7, patricii: 3, legiones: 14 } },
  E1: { topBuys: [{ category: "Grain", count: 3 }, { category: "Weapons", count: 3 }, { category: "Meat Animals", count: 2 }], encounters: { nefarii: 13, patricii: 4, legiones: 15 } },
  E2: { topBuys: [{ category: "Grain", count: 4 }, { category: "Marble", count: 2 }, { category: "Weapons", count: 2 }], encounters: { nefarii: 10, patricii: 3, legiones: 12 } },
  E3: { topBuys: [{ category: "Marble", count: 3 }, { category: "Meat Animals", count: 3 }, { category: "Grain", count: 2 }], encounters: { nefarii: 11, patricii: 7, legiones: 13 } },
  E4: { topBuys: [{ category: "Weapons", count: 3 }, { category: "Animals", count: 2 }, { category: "Cheap Wine", count: 2 }], encounters: { nefarii: 9, patricii: 4, legiones: 11 } },
  E5: { topBuys: [{ category: "Grain", count: 4 }, { category: "Marble", count: 2 }, { category: "Weapons", count: 2 }], encounters: { nefarii: 11, patricii: 3, legiones: 10 } },
  E6: { topBuys: [{ category: "Grain", count: 3 }, { category: "Cheap Wine", count: 2 }, { category: "Marble", count: 2 }], encounters: { nefarii: 11, patricii: 2, legiones: 9 } },
  F1: { topBuys: [{ category: "Grain", count: 3 }, { category: "Meat Animals", count: 2 }, { category: "Weapons", count: 2 }], encounters: { nefarii: 8, patricii: 2, legiones: 16 } },
  F2: { topBuys: [{ category: "Fine Wine", count: 3 }, { category: "Marble", count: 3 }, { category: "Grain", count: 2 }], encounters: { nefarii: 9, patricii: 6, legiones: 12 } },
  F3: { topBuys: [{ category: "Grain", count: 3 }, { category: "Marble", count: 2 }, { category: "Meat Animals", count: 2 }], encounters: { nefarii: 7, patricii: 5, legiones: 14 } },
  F4: { topBuys: [{ category: "Grain", count: 2 }, { category: "Marble", count: 2 }, { category: "Meat Animals", count: 2 }], encounters: { nefarii: 9, patricii: 6, legiones: 10 } },
  F5: { topBuys: [{ category: "Weapons", count: 3 }, { category: "Cheap Wine", count: 2 }, { category: "Exotic Animals", count: 2 }], encounters: { nefarii: 12, patricii: 5, legiones: 10 } },
  F6: { topBuys: [{ category: "Grain", count: 3 }, { category: "Marble", count: 2 }, { category: "Weapons", count: 2 }], encounters: { nefarii: 9, patricii: 3, legiones: 10 } },
};

const STACK_CATEGORY_SHORT_LABELS = {
  Grain: "Grain",
  "Meat Animals": "Meat Anim.",
  "Exotic Animals": "Exotic Anim.",
  Animals: "Any Animal",
  "Cheap Wine": "Cheap Wine",
  "Fine Wine": "Fine Wine",
  Wine: "Any Wine",
  Weapons: "Weapons",
  Marble: "Marble",
};

function createStackWatermarkSvg(kind) {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("class", "tile-watermark-svg");
  svg.setAttribute("aria-hidden", "true");

  const mkEl = (tag, attrs) => {
    const node = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      node.setAttribute(k, String(v));
    }
    return node;
  };

  if (kind === "Grain") {
    const c = "#7b4a1e";
    svg.appendChild(mkEl("path", { d: "M24 44 V14 M24 42 C18 33 14 25 13 13 M24 42 C30 33 34 25 35 13", fill: "none", stroke: c, "stroke-width": "2.4", "stroke-linecap": "round" }));
    svg.appendChild(mkEl("rect", { x: "18", y: "34", width: "12", height: "3.2", rx: "1.4", fill: c }));
    // Center wheat ear kernels
    for (const y of [10, 15, 20, 25]) {
      svg.appendChild(mkEl("ellipse", { cx: "21.4", cy: y, rx: "2.3", ry: "3.5", transform: `rotate(-25 21.4 ${y})`, fill: c }));
      svg.appendChild(mkEl("ellipse", { cx: "26.6", cy: y, rx: "2.3", ry: "3.5", transform: `rotate(25 26.6 ${y})`, fill: c }));
    }
    svg.appendChild(mkEl("ellipse", { cx: "24", cy: "6.2", rx: "2.1", ry: "3.4", fill: c }));
    // Side stalks kernels
    for (const [cx, cy, ang] of [[11.2, 13.5, -24], [14.8, 17, 16], [10.8, 19.5, -24], [36.8, 13.5, 24], [33.2, 17, -16], [37.2, 19.5, 24]]) {
      svg.appendChild(mkEl("ellipse", { cx, cy, rx: "2", ry: "3.1", transform: `rotate(${ang} ${cx} ${cy})`, fill: c }));
    }
  } else if (kind === "Meat Animals") {
    const c = "#d9651f";
    // Crisp standing Roman chicken silhouette
    svg.appendChild(mkEl("path", {
      d: "M17 17 C16 12 12 11 9.5 13 C8.5 14 8.5 16 10 17 L6.5 18.2 L9.5 19.6 C9 23 11.5 27 14 29.5 C16.5 34.5 24 36.5 31.5 34.5 C36 33.2 39 28.5 39.5 23 C42.5 20 43.5 15.5 41 13 C39.5 14 38 15.5 36.5 17.5 C37 14.5 36 12 33.8 11.5 C33 14.5 31.5 17.5 29.5 20 C24 20.5 20.5 19.5 17 17 Z",
      fill: c,
    }));
    // Comb
    svg.appendChild(mkEl("path", { d: "M10.5 12 C10.5 8.5 13 8 13.8 10.2 C14.5 7.8 17 8.2 17.2 11 C18.5 9.2 20 10.5 19 13 Z", fill: c }));
    // Legs
    svg.appendChild(mkEl("path", { d: "M22 34 L21 42 M18.5 42 H24 M29 34 L30 42 M27.5 42 H33", fill: "none", stroke: c, "stroke-width": "2.4", "stroke-linecap": "round" }));
  } else if (kind === "Exotic Animals") {
    const c = "#d9651f";
    // Majestic striding lion silhouette
    svg.appendChild(mkEl("path", {
      d: "M13 11 C9 12 7 16 8.5 20 C7.5 23 9.5 26 13 26.5 L13.5 39 H17.5 L18.5 29 H30 L31.5 39 H35.5 L36.5 25 C39 24.5 41.5 22 42 18.5 C42.5 15 40 13 38.5 14 C39.5 17 38 20.5 35.5 21.5 H22 C21.5 16 18 11 13 11 Z",
      fill: c,
    }));
    svg.appendChild(mkEl("circle", { cx: "14", cy: "17.5", r: "6.8", fill: c }));
  } else if (kind === "Animals") {
    const c = "#d9651f";
    // Horned Roman bull/livestock head
    svg.appendChild(mkEl("path", {
      d: "M10 11 C7 14 7.5 19.5 12.5 21.5 L14.5 31 C15.2 35.5 19 39 24 39 C29 39 32.8 35.5 33.5 31 L35.5 21.5 C40.5 19.5 41 14 38 11 C38 15 35.5 17.5 32 17.5 H16 C12.5 17.5 10 15 10 11 Z",
      fill: c,
    }));
    svg.appendChild(mkEl("path", { d: "M13 20 L7.5 23 L12.5 24.5 M35 20 L40.5 23 L35.5 24.5", fill: "none", stroke: c, "stroke-width": "2.6", "stroke-linecap": "round" }));
  } else if (kind === "Wine" || kind === "Cheap Wine" || kind === "Fine Wine") {
    const c = "#6b2d8b";
    // Purple Roman two-handled amphora
    const bodyPath =
      kind === "Fine Wine"
        ? "M19 9 H29 L28 13 L27.5 18 C32.5 20 34 26 32.5 33 C31 38 26.5 42.5 24 44.5 C21.5 42.5 17 38 15.5 33 C14 26 15.5 20 20.5 18 L20 13 Z"
        : kind === "Cheap Wine"
          ? "M18.5 10 H29.5 L28 14 C34.5 16.5 36.5 23 35 31 C33.5 37.5 27.5 42 24 44 C20.5 42 14.5 37.5 13 31 C11.5 23 13.5 16.5 20 14 Z"
          : "M19 9.5 H29 L28 14.5 C33.5 17.5 35 24 33.5 32 C32 38 27 42 24 44.5 C21 42 16 38 14.5 32 C13 24 14.5 17.5 20 14.5 Z";
    svg.appendChild(mkEl("path", { d: bodyPath, fill: c }));
    svg.appendChild(mkEl("path", { d: "M20 12.5 C12.5 12.5 10.5 21 15 24 M28 12.5 C35.5 12.5 37.5 21 33 24", fill: "none", stroke: c, "stroke-width": "2.8", "stroke-linecap": "round" }));
    svg.appendChild(mkEl("rect", { x: "17.5", y: "7", width: "13", height: "3", rx: "1.4", fill: c }));
  } else if (kind === "Weapons") {
    const c = "#464e50";
    // Curved Roman scutum & crossed gladius
    svg.appendChild(mkEl("rect", { x: "14", y: "10", width: "20", height: "28", rx: "4.5", fill: c }));
    svg.appendChild(mkEl("circle", { cx: "24", cy: "24", r: "4.2", fill: "#fdfbf6", stroke: c, "stroke-width": "2" }));
    svg.appendChild(mkEl("path", { d: "M9 39 L39 9 M10.5 31.5 L16.5 37.5", stroke: c, "stroke-width": "3.2", "stroke-linecap": "round" }));
  } else if (kind === "Marble") {
    const c = "#1d6b83";
    // Fluted Roman Ionic column
    svg.appendChild(mkEl("rect", { x: "11", y: "9", width: "26", height: "4", rx: "1.2", fill: c }));
    svg.appendChild(mkEl("circle", { cx: "13", cy: "15.5", r: "3.6", fill: c }));
    svg.appendChild(mkEl("circle", { cx: "35", cy: "15.5", r: "3.6", fill: c }));
    svg.appendChild(mkEl("rect", { x: "16", y: "14", width: "16", height: "23", fill: c }));
    for (const fx of [19.5, 24, 28.5]) {
      svg.appendChild(mkEl("line", { x1: fx, y1: "16.5", x2: fx, y2: "34.5", stroke: "#fdfbf6", "stroke-width": "1.6", "stroke-linecap": "round" }));
    }
    svg.appendChild(mkEl("rect", { x: "11", y: "37", width: "26", height: "4.5", rx: "1.2", fill: c }));
  } else if (kind === "nefarii") {
    const c = "#64748b";
    // Gray hooded Nefarius silhouette
    svg.appendChild(mkEl("path", {
      d: "M24 6.5 C15 6.5 10.5 13 9.5 22.5 L6.5 41.5 H41.5 L38.5 22.5 C37.5 13 33 6.5 24 6.5 Z",
      fill: c,
    }));
    svg.appendChild(mkEl("ellipse", { cx: "24", cy: "20.5", rx: "7.2", ry: "8.2", fill: "#fdfbf6" }));
    svg.appendChild(mkEl("path", { d: "M17.5 19.2 Q24 16.5 30.5 19.2 L29.2 22.4 Q24 21 18.8 22.4 Z", fill: c }));
  } else if (kind === "patricii") {
    const c = "#c88a12";
    // Gold Patrician senator bust with laurel & toga fold
    svg.appendChild(mkEl("circle", { cx: "24", cy: "14.5", r: "7", fill: c }));
    svg.appendChild(mkEl("path", { d: "M11 41.5 C11 30.5 16.5 24.5 24 24.5 C31.5 24.5 37 30.5 37 41.5 Z", fill: c }));
    svg.appendChild(mkEl("path", { d: "M16 26.5 L32 39.5", stroke: "#fdfbf6", "stroke-width": "2.2", "stroke-linecap": "round" }));
  } else if (kind === "legiones") {
    const c = "#b91c1c";
    // Red Roman Legionary crested galea helmet
    svg.appendChild(mkEl("path", { d: "M12 16 C12 7.5 36 7.5 36 16 L32 18 H16 Z", fill: c }));
    svg.appendChild(mkEl("path", {
      d: "M13.5 23.5 C13.5 16.5 18 13 24 13 C30 13 34.5 16.5 34.5 23.5 L38 27 H10 L13.5 23.5 Z",
      fill: c,
    }));
    svg.appendChild(mkEl("path", { d: "M12.5 27 H19.5 V38.5 L13.5 36 Z M28.5 27 H35.5 L34.5 36 L28.5 38.5 Z", fill: c }));
  }
  return svg;
}

function renderTileStackWatermarkSection(coord, _cell) {
  const profile = TILE_STACK_PROFILES[coord];
  if (!profile) return null;

  const mkBadge = (iconKind, count, shortLabel, hoverText) =>
    el(
      "div",
      {
        className: "tile-watermark-badge",
        "data-hover-title": hoverText,
      },
      el(
        "div",
        { className: "tile-watermark-glyph" },
        createStackWatermarkSvg(iconKind),
        el("span", { className: "tile-watermark-count", text: String(count) })
      ),
      el("span", { className: "tile-watermark-label", text: shortLabel })
    );

  const buyNodes = (profile.topBuys || []).map((entry) => {
    const shortLbl = STACK_CATEGORY_SHORT_LABELS[entry.category] || entry.category;
    return mkBadge(
      entry.category,
      entry.count,
      shortLbl,
      `Buys ${entry.category} on ${entry.count} card${entry.count === 1 ? "" : "s"} in stack`
    );
  });

  const encCounts = profile.encounters || {};
  const encSpecs = [
    { key: "nefarii", label: "Nefarii", count: encCounts.nefarii || 0 },
    { key: "patricii", label: "Patricii", count: encCounts.patricii || 0 },
    { key: "legiones", label: "Legiones", count: encCounts.legiones || 0 },
  ];
  const encNodes = encSpecs.map((spec) =>
    mkBadge(
      spec.key,
      spec.count,
      spec.label,
      `${spec.count} ${spec.label} icon${spec.count === 1 ? "" : "s"} total (center + edges) across all cards in stack`
    )
  );

  return el(
    "div",
    { className: "tile-stack-watermarks-box" },
    el(
      "div",
      { className: "tile-stack-watermarks-header" },
      el("span", { text: "Looking to buy" }),
      el("span", { text: "Encounter icon totals" })
    ),
    el(
      "div",
      { className: "tile-stack-watermarks-strip" },
      el("div", { className: "tile-stack-watermarks-group" }, ...buyNodes),
      el("div", { className: "tile-stack-watermarks-divider", "aria-hidden": "true" }),
      el("div", { className: "tile-stack-watermarks-group" }, ...encNodes)
    )
  );
}

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

const ENCOUNTER_DECK_PROFILES = {
  patricii: {
    key: "patricii",
    label: "Patricii",
    subtitle: "Senators, Magistrates & Nobles",
    totalCards: 30,
    img: "/assets/icons/card_back_patricii.png?v=24",
    mechanicsSummary:
      "Rich in Julia Domna (8) and Aurelius (8) ties; rewards high favor with lucrative Missions, Denarii, and Influence, while hostile nobles demand bribes or luxury goods.",
    historicalSummary:
      "Rome's hereditary senatorial elite. Wealthy yet caught between Severan dynastic purges and old Claudio-Aurelian prestige, they trade favors behind marble peristyles.",
  },
  legiones: {
    key: "legiones",
    label: "Legionnaire (Legiones)",
    filterValue: "Legiones",
    subtitle: "Praetorians, Vigiles & Cohorts",
    totalCards: 30,
    img: "/assets/icons/card_back_legiones.png?v=24",
    mechanicsSummary:
      "Dominated by Caracalla (9) and Plautilla (8) ties; frequent Combat checkpoints (boosted +2 CP by Army Pay Hike), heavy fines, and cargo seizures.",
    historicalSummary:
      "Praetorian guardsmen, urban cohorts, and night watchmen. Far from neutral peacekeepers, soldiers in Severan Rome extorted bribes, raided carts, and were often as dangerous to merchants as street criminals.",
  },
  nefarii: {
    key: "nefarii",
    label: "Nefarii",
    subtitle: "Syndicates, Smugglers & Cutthroats",
    totalCards: 29,
    img: "/assets/icons/card_back_nefarii.png?v=24",
    mechanicsSummary:
      "Balanced across Caracalla, Geta, and Domna (5 each) with deep Plautilla (8) roots; risky ambushes and shakedowns, or underworld shortcuts and contracts if favored.",
    historicalSummary:
      "Rome's nocturnal underworld of collegia thugs, Subura cutthroats, and black-market fences—deadly to outsiders yet deeply intertwined with exiled Plautilla's covert rings.",
  },
};

const OTHER_DECK_PROFILES = {
  market: {
    key: "market",
    label: "Goods & Guards",
    subtitle: "Cargo & Armed Escorts",
    totalCards: 84,
    img: "/assets/icons/card_back_goods.png?v=24",
    mechanicsSummary:
      "Drawn into the 6 Ostia Port Market tracks each Season: Grain (12), Animals (18: Meat & Exotic), Wine (18: Cheap & Fine), Weapons (12), Marble (12), and Guards (12). Shifts Scarcity dynamically as cards are drawn or sold.",
    historicalSummary:
      "Bulk grain barges from Egypt, amphorae of Falernian and posca, Apuan marble blocks, gladius steel, exotic beast cages, and hired Thracian or Illyrian escorts landing on Ostia's docks.",
  },
  missiones: {
    key: "missiones",
    label: "Missiones",
    subtitle: "Deliveries, Purchases & Contracts",
    totalCards: 52,
    icon: "📜",
    mechanicsSummary:
      "Personal and Patron contracts across Rome's five imperial factions. Unfulfilled active Missions at Winter's end subtract from your Net Missions unless completed or balanced by Patronage.",
    historicalSummary:
      "Sealed waxed tablets from senatorial procurators, Praetorian quartermasters, and collegia brokers commissioning nocturnal freight runs between Ostia and Rome's seven hills.",
  },
  influence: {
    key: "influence",
    label: "Influence",
    subtitle: "Schemes, Patronage & Interventions",
    totalCards: 40,
    icon: "🃏",
    mechanicsSummary:
      "Spontaneous anytime cards (Patron, Favor, Cartwright, Thug, Wine Forger, Procurer), turn utilities (Informants, Prophecy, Puffery, Make Haste, Shortcut), and reactive combat, chart, demand, or die-roll plays.",
    historicalSummary:
      "Whispered bribes, back-alley ambushes, hired dramatists, street urchins, and forged vintage labels—the covert currency of survival in Severan Rome after dark.",
  },
};

const GOODS_DECK_CATEGORY_META = [
  { key: "Grain", icon: "🌾", base: 12 },
  { key: "Animals", icon: "🐑", base: 18 },
  { key: "Wine", icon: "🍷", base: 18 },
  { key: "Weapons", icon: "⚔️", base: 12 },
  { key: "Marble", icon: "🏛️", base: 12 },
  { key: "Guards", icon: "🛡️", base: 12 },
];

function renderGoodsDeckCategoryStripNode(gs) {
  const liveMap = (gs && gs.goodsDeckCounts) || null;
  return el(
    "div",
    { className: "goods-deck-categories-row" },
    ...GOODS_DECK_CATEGORY_META.map((cat) => {
      const entry = liveMap && liveMap[cat.key];
      const base = entry && typeof entry.base === "number" ? entry.base : cat.base;
      const rem = entry && typeof entry.remaining === "number" ? entry.remaining : base;
      const countText = liveMap && rem !== base ? `${rem}/${base}` : String(rem);
      const subParts = [];
      if (entry && entry.subcounts && typeof entry.subcounts === "object") {
        Object.entries(entry.subcounts).forEach(([k, v]) => {
          subParts.push(`${k}: ${v}`);
        });
      }
      const subSuffix = subParts.length > 0 ? ` (${subParts.join(", ")})` : "";
      const tip = liveMap
        ? `${cat.key} remaining in Goods deck: ${rem} of ${base}${subSuffix}`
        : `${cat.key}: ${base} of 84 cards in Goods & Guards deck`;
      return el("span", {
        className: "encounter-deck-gem-chip goods-cat-chip",
        title: tip,
        text: `${cat.icon} ${cat.key}: ${countText}`,
      });
    })
  );
}

function canViewerScoutNow(gs, viewer) {
  if (!gs || !viewer) return { eligible: false, actionType: null };
  if (gs.phase === "delivery_entry" && !viewer.scoutedThisTurn) {
    return { eligible: true, actionType: "initial_scout" };
  }
  if (
    gs.phase === "delivery" &&
    gs.activePlayerIndex === viewer.index &&
    !viewer.exitedRome &&
    !viewer.nightEnded &&
    !viewer.eliminated &&
    !viewer.scoutedThisTurn &&
    !gs.pendingEncounter &&
    !hasPlayerBlockingPrompt(viewer, true, gs)
  ) {
    return { eligible: true, actionType: "delivery_scout" };
  }
  return { eligible: false, actionType: null };
}

const ALL_PICKER_DECK_SPECS = [
  { key: "patricii", label: "Patricii", img: "/assets/icons/card_back_patricii.png?v=24" },
  { key: "nefarii", label: "Nefarii", img: "/assets/icons/card_back_nefarii.png?v=24" },
  { key: "legiones", label: "Legionnaire", img: "/assets/icons/card_back_legiones.png?v=24" },
  {
    key: "market",
    label: "Goods & Guards",
    img: "/assets/icons/card_back_goods.png?v=24",
    shortDesc: "Next Cargo or Guard card drawn into Ostia Port Market tracks.",
  },
  {
    key: "missiones",
    label: "Missiones",
    icon: "📜",
    shortDesc: "Next Delivery, Trade, or Contract Mission drawn into Rome.",
  },
  {
    key: "influence",
    label: "Influence",
    icon: "🃏",
    shortDesc: "Next tactical Influence scheme card (purchased at Dawn or drawn via encounters).",
  },
];

function getEncounterDeckFactionStats(gs, deckKey, useLiveCounts = true) {
  const profile = ENCOUNTER_DECK_PROFILES[deckKey];
  if (!profile) return null;
  const liveByFaction = (useLiveCounts && gs && gs.factionDeckCounts) || null;
  const liveDeckTotal =
    useLiveCounts && gs && gs.deckCounts && typeof gs.deckCounts[deckKey] === "number"
      ? gs.deckCounts[deckKey]
      : profile.totalCards;

  let baseFactionSum = 0;
  let liveFactionSum = 0;
  const factions = FACTION_META.map((fm) => {
    const base = Number((fm.defaultDeckCounts && fm.defaultDeckCounts[deckKey]) || 0);
    const live =
      liveByFaction && liveByFaction[fm.key] && typeof liveByFaction[fm.key][deckKey] === "number"
        ? liveByFaction[fm.key][deckKey]
        : base;
    baseFactionSum += base;
    liveFactionSum += live;
    return {
      meta: fm,
      base,
      live,
    };
  });

  const baseEvents = Math.max(0, profile.totalCards - baseFactionSum);
  const liveEvents = liveByFaction ? Math.max(0, liveDeckTotal - liveFactionSum) : baseEvents;

  return {
    profile,
    factions,
    baseEvents,
    liveEvents,
    baseTotal: profile.totalCards,
    liveTotal: liveDeckTotal,
    isLive: Boolean(liveByFaction),
  };
}

function renderEncounterDeckGemsStripNode(gs, deckKey, opts = {}) {
  const stats = getEncounterDeckFactionStats(gs, deckKey, opts.useLiveCounts !== false);
  if (!stats) return null;
  const { profile, factions, baseEvents, liveEvents, isLive } = stats;

  return el(
    "div",
    { className: "encounter-deck-gems-row" },
    ...factions.map(({ meta, base, live }) => {
      const capGem = meta.gemSingular.charAt(0).toUpperCase() + meta.gemSingular.slice(1);
      const countText = isLive && live !== base ? `${live}/${base}` : String(base);
      const tip =
        isLive && live !== base
          ? `${meta.key} (${capGem}): ${live} remaining of ${base} total in ${profile.label}`
          : `${meta.key} (${capGem}): ${base} of ${profile.totalCards} cards in ${profile.label}`;
      return el(
        "span",
        {
          className: "encounter-deck-gem-chip",
          title: tip,
        },
        el("img", {
          src: meta.gem,
          alt: meta.key,
          style: { width: "13px", height: "13px", objectFit: "contain", flex: "0 0 auto" },
        }),
        el("span", {
          style: { color: meta.color },
          text: opts.showFactionName ? `${meta.key} ${countText}` : countText,
        })
      );
    }),
    baseEvents > 0 || liveEvents > 0
      ? el("span", {
          className: "encounter-deck-gem-chip is-event-chip",
          title:
            isLive && liveEvents !== baseEvents
              ? `Unaligned Events: ${liveEvents} remaining of ${baseEvents} total in ${profile.label}`
              : `Unaligned Events: ${baseEvents} cards in ${profile.label}`,
          text:
            isLive && liveEvents !== baseEvents
              ? `📜 ${liveEvents}/${baseEvents}`
              : `📜 ${baseEvents}`,
        })
      : null
  );
}

function renderEncounterDeckMetaBlockNode(gs, deckKey, opts = {}) {
  const profile = ENCOUNTER_DECK_PROFILES[deckKey];
  if (!profile) return null;
  const includeHistory = opts.includeHistory !== false;
  return el(
    "div",
    { className: "encounter-deck-meta-box" },
    el(
      "div",
      { className: "encounter-deck-meta-line" },
      el("span", { className: "encounter-deck-meta-tag", text: "Mechanics:" }),
      profile.mechanicsSummary
    ),
    includeHistory
      ? el(
          "div",
          { className: "encounter-deck-meta-line" },
          el("span", { className: "encounter-deck-meta-tag", text: "History:" }),
          profile.historicalSummary
        )
      : null,
    renderEncounterDeckGemsStripNode(gs, deckKey, opts)
  );
}

function openEncounterDecksOverviewModal(gs, focusDeck = null) {
  const deckKeys = ["patricii", "legiones", "nefarii", "market", "missiones", "influence"];
  const normalizedFocus = focusDeck ? String(focusDeck).trim().toLowerCase() : null;
  const counts = (gs && gs.deckCounts) || {};
  const viewer = gs ? getViewerPlayer(gs) : null;
  const scoutEligibility = canViewerScoutNow(gs, viewer);

  showModal(
    "🃏 Game Decks — Composition, Goods Odds & Faction Ties",
    el(
      "div",
      {},
      el("p", {
        style: { fontSize: "0.84rem", color: "var(--text-main)", marginTop: "0", marginBottom: "0.75rem" },
        text: "Inspect all six Roman decks at any time: the three Encounter decks (faction & event odds), Goods & Guards (remaining vs. starting counts for all 6 market categories), Missiones, and Influence. When eligible to Scout, you can also peek at the top card of any deck below.",
      }),
      el(
        "div",
        { className: "encounter-deck-profiles-grid" },
        ...deckKeys.map((dk) => {
          const profile = ENCOUNTER_DECK_PROFILES[dk] || OTHER_DECK_PROFILES[dk];
          const rem = typeof counts[dk] === "number" ? counts[dk] : profile.totalCards;
          const isFocused = normalizedFocus === dk;
          const isEnc = Boolean(ENCOUNTER_DECK_PROFILES[dk]);

          const thumbNode = profile.img
            ? el("img", {
                className: "encounter-deck-profile-thumb",
                src: profile.img,
                alt: `${profile.label} Card Back`,
              })
            : el(
                "div",
                {
                  className: "encounter-deck-profile-thumb deck-symbol-thumb",
                  style: {
                    background:
                      dk === "missiones"
                        ? "radial-gradient(circle at 50% 35%, #5b3a1d, #241509)"
                        : "radial-gradient(circle at 50% 35%, #4c1d4b, #1d0c24)",
                  },
                },
                profile.icon || "📜"
              );

          const metaNode = isEnc
            ? renderEncounterDeckMetaBlockNode(gs, dk, {
                useLiveCounts: true,
                includeHistory: true,
                showFactionName: false,
              })
            : el(
                "div",
                { className: "encounter-deck-meta-box" },
                el(
                  "div",
                  { className: "encounter-deck-meta-line" },
                  el("span", { className: "encounter-deck-meta-tag", text: "Mechanics:" }),
                  profile.mechanicsSummary
                ),
                el(
                  "div",
                  { className: "encounter-deck-meta-line" },
                  el("span", { className: "encounter-deck-meta-tag", text: "History:" }),
                  profile.historicalSummary
                ),
                dk === "market" ? renderGoodsDeckCategoryStripNode(gs) : null
              );

          return el(
            "div",
            { className: `encounter-deck-profile-card ${isFocused ? "is-active" : ""}` },
            el(
              "div",
              { className: "encounter-deck-profile-head" },
              thumbNode,
              el(
                "div",
                { style: { flex: "1 1 auto", minWidth: "0" } },
                el("div", { className: "encounter-deck-profile-title", text: profile.label }),
                el("div", {
                  className: "encounter-deck-profile-sub",
                  text: `${profile.subtitle} • ${
                    typeof counts[dk] === "number"
                      ? `${rem} left / ${profile.totalCards} total`
                      : `${profile.totalCards} total cards`
                  }`,
                })
              )
            ),
            metaNode,
            scoutEligibility.eligible
              ? el("button", {
                  type: "button",
                  className: "btn btn-sm btn-primary",
                  style: { marginTop: "auto", width: "100%" },
                  disabled: typeof counts[dk] === "number" && counts[dk] <= 0,
                  text:
                    typeof counts[dk] === "number" && counts[dk] <= 0
                      ? "Deck Empty"
                      : `👁️ Scout Top of ${profile.label}`,
                  onClick: () => {
                    closeModal();
                    sendGameAction({
                      type: scoutEligibility.actionType,
                      targetType: "deck",
                      targetKey: dk,
                    });
                  },
                })
              : null
          );
        })
      ),
      el(
        "div",
        { style: { display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" } },
        el("button", {
          type: "button",
          className: "btn",
          text: "📖 Open Rulebook Card Catalog",
          onClick: () => {
            closeModal();
            openFullRulebookView("catalog-encounters");
          },
        }),
        el("button", {
          type: "button",
          className: "btn btn-primary",
          text: "Close",
          onClick: closeModal,
        })
      )
    ),
    { wide: true }
  );
}

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
    shortText: "Most Geta favor loses 25d",
    description: "End of game: Most Geta favor loses 25d.",
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
    title: "Opulence",
    shortText: "All players start with +1 Emerald",
    description: "All players start with +1 Emerald.",
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
    title: "Loyalty Rewards",
    shortText: "10 × A × B (A = faction gems, B = faction missions)",
    description: "End of game: Each player receives 10 × A × B denarii. A = gems of any one faction, B = missions completed for that faction.",
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

function isOrthogonalTiberCrossing(fromCoord, toCoord) {
  if (!fromCoord || !toCoord || fromCoord === toCoord) return false;
  if (WEST_BANK_CELLS.has(fromCoord) === WEST_BANK_CELLS.has(toCoord)) return false;
  const fc = COLS.indexOf(fromCoord.slice(0, 1));
  const fr = ROWS.indexOf(fromCoord.slice(1));
  const tc = COLS.indexOf(toCoord.slice(0, 1));
  const tr = ROWS.indexOf(toCoord.slice(1));
  if (fc < 0 || fr < 0 || tc < 0 || tr < 0) return false;
  return Math.abs(fc - tc) + Math.abs(fr - tr) === 1;
}

function getTiberBridgeName(fromCoord, toCoord) {
  if (!isOrthogonalTiberCrossing(fromCoord, toCoord)) return null;
  return TIBER_BRIDGES[`${fromCoord}|${toCoord}`] || "Tiber Crossing";
}

function isTiberCrossingBlocked(fromCoord, toCoord) {
  if (!fromCoord || !toCoord || fromCoord === toCoord) return false;
  if (WEST_BANK_CELLS.has(fromCoord) === WEST_BANK_CELLS.has(toCoord)) return false;
  return !isOrthogonalTiberCrossing(fromCoord, toCoord);
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

function getTileBackBackgroundPosition(coord) {
  const c = String(coord || "B1").trim();
  const colIdx = Math.max(0, COLS.indexOf(c.slice(0, 1)));
  const rowIdx = Math.max(0, ROWS.indexOf(c.slice(1)));
  return `${(colIdx / 5) * 100}% ${(rowIdx / 5) * 100}%`;
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

const BOT_DIFFICULTIES = ["doric", "ionic", "corinthian"];

const BOT_DIFFICULTY_META = {
  doric: {
    id: "doric",
    label: "Doric (Easy)",
    shortLabel: "Doric",
    tier: "Easy",
    title: "Doric AI — Easy difficulty",
    color: "#5d6f7d",
    accent: "#d3dfe6",
  },
  ionic: {
    id: "ionic",
    label: "Ionic (Medium)",
    shortLabel: "Ionic",
    tier: "Medium",
    title: "Ionic AI — Medium difficulty",
    color: "#9c6d27",
    accent: "#efd082",
  },
  corinthian: {
    id: "corinthian",
    label: "Corinthian (Hard)",
    shortLabel: "Corinthian",
    tier: "Hard",
    title: "Corinthian AI — Hard difficulty",
    color: "#841f35",
    accent: "#df7f95",
  },
};

function normalizeBotDifficulty(value) {
  const key = String(value || "ionic").trim().toLowerCase();
  return BOT_DIFFICULTY_META[key] ? key : "ionic";
}

function createSvgNode(tag, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) {
      node.setAttribute(k, String(v));
    }
  }
  return node;
}

/**
 * Renders a classical Roman/Greek Column Capital SVG silhouette indicating AI difficulty:
 * Doric (Easy), Ionic (Medium), or Corinthian (Hard). Built cleanly with createElementNS.
 */
function createColumnCapitalIconNode(difficulty, size = 18) {
  const diff = normalizeBotDifficulty(difficulty);
  const meta = BOT_DIFFICULTY_META[diff];
  const svg = createSvgNode("svg", {
    viewBox: "0 0 24 24",
    width: size,
    height: size,
    class: `bot-capital-icon bot-capital-${diff}`,
    role: "img",
    "aria-label": meta.title,
    "data-hover-title": meta.title,
  });

  const titleNode = createSvgNode("title");
  titleNode.textContent = meta.title;
  svg.appendChild(titleNode);

  const appendFlutedShaft = (x, y, w, h, fluteColor, strokeColor) => {
    svg.appendChild(createSvgNode("rect", {
      x: String(x),
      y: String(y),
      width: String(w),
      height: String(h),
      rx: "0.5",
      fill: meta.color,
      stroke: strokeColor,
      "stroke-width": "0.9",
    }));
    const fluteTop = y + 0.8;
    const fluteBot = y + h - 0.8;
    for (const fx of [x + w * 0.33, x + w * 0.67]) {
      svg.appendChild(createSvgNode("line", {
        x1: fx.toFixed(1),
        y1: fluteTop.toFixed(1),
        x2: fx.toFixed(1),
        y2: fluteBot.toFixed(1),
        stroke: fluteColor,
        "stroke-width": "1.05",
        "stroke-linecap": "round",
      }));
    }
  };

  if (diff === "doric") {
    const dark = "#231710";
    appendFlutedShaft(8.0, 12.7, 8.0, 9.8, meta.accent, dark);
    svg.appendChild(createSvgNode("rect", {
      x: "7.2", y: "11.0", width: "9.6", height: "1.8", rx: "0.5",
      fill: meta.color, stroke: dark, "stroke-width": "0.8",
    }));
    svg.appendChild(createSvgNode("path", {
      d: "M3.4 5.6 C4.4 9.2 6.5 10.8 8.0 11.0 L16.0 11.0 C17.5 10.8 19.6 9.2 20.6 5.6 Z",
      fill: meta.accent, stroke: dark, "stroke-width": "0.9",
    }));
    svg.appendChild(createSvgNode("rect", {
      x: "1.8", y: "2.0", width: "20.4", height: "3.6", rx: "0.7",
      fill: meta.color, stroke: dark, "stroke-width": "0.9",
    }));
  } else if (diff === "ionic") {
    const dark = "#231710";
    appendFlutedShaft(8.2, 11.4, 7.6, 11.1, meta.accent, dark);
    svg.appendChild(createSvgNode("rect", {
      x: "7.6", y: "9.7", width: "8.8", height: "1.7", rx: "0.45",
      fill: meta.color, stroke: dark, "stroke-width": "0.8",
    }));
    svg.appendChild(createSvgNode("rect", {
      x: "6.4", y: "4.5", width: "11.2", height: "5.2", rx: "0.7",
      fill: meta.accent, stroke: dark, "stroke-width": "0.85",
    }));
    svg.appendChild(createSvgNode("rect", {
      x: "3.4", y: "2.0", width: "17.2", height: "2.5", rx: "0.6",
      fill: meta.color, stroke: dark, "stroke-width": "0.9",
    }));
    for (const [cx, arcD] of [
      ["5.1", "M5.1 5.0 A2.35 2.35 0 1 1 3.1 8.1 A1.3 1.3 0 1 1 5.5 7.4"],
      ["18.9", "M18.9 5.0 A2.35 2.35 0 1 0 20.9 8.1 A1.3 1.3 0 1 0 18.5 7.4"],
    ]) {
      svg.appendChild(createSvgNode("circle", {
        cx, cy: "7.4", r: "3.8",
        fill: meta.accent, stroke: dark, "stroke-width": "0.9",
      }));
      svg.appendChild(createSvgNode("path", {
        d: arcD, fill: "none", stroke: dark, "stroke-width": "1.0", "stroke-linecap": "round",
      }));
    }
  } else {
    // Ornate floral Corinthian: blooming acanthus fronds, golden corner helices, 4-petal rosette fleuron
    const dark = "#241114";
    const petalIvory = "#fff1f4";
    const gold = "#f5cb66";
    const abacusRose = "#b83b56";

    appendFlutedShaft(8.1, 15.6, 7.8, 6.9, petalIvory, dark);
    // Golden astragal collar ring
    svg.appendChild(createSvgNode("rect", {
      x: "6.9", y: "13.9", width: "10.2", height: "1.8", rx: "0.8",
      fill: gold, stroke: dark, "stroke-width": "0.85",
    }));
    // Crimson calyx bell cup
    svg.appendChild(createSvgNode("path", {
      d: "M4.8 4.9 L19.2 4.9 C19.0 9.0 17.5 11.8 16.1 13.9 L7.9 13.9 C6.5 11.8 5.0 9.0 4.8 4.9 Z",
      fill: meta.color, stroke: dark, "stroke-width": "0.85",
    }));
    // Molded concave abacus slab
    svg.appendChild(createSvgNode("path", {
      d: "M2.8 2.9 Q12 3.8 21.2 2.9 L20.6 5.0 Q12 5.7 3.4 5.0 Z",
      fill: abacusRose, stroke: dark, "stroke-width": "0.85", "stroke-linejoin": "round",
    }));
    // Curled golden floral corner helices under the abacus
    for (const [cx, arcD] of [
      ["3.7", "M3.7 5.0 A0.95 0.95 0 1 1 2.8 6.4"],
      ["20.3", "M20.3 5.0 A0.95 0.95 0 1 0 21.2 6.4"],
    ]) {
      svg.appendChild(createSvgNode("circle", {
        cx, cy: "6.1", r: "2.0",
        fill: gold, stroke: dark, "stroke-width": "0.8",
      }));
      svg.appendChild(createSvgNode("path", {
        d: arcD, fill: "none", stroke: dark, "stroke-width": "0.85", "stroke-linecap": "round",
      }));
    }
    // Three upper blooming ivory acanthus fronds
    for (const d of [
      "M7.8 13.9 C4.5 13.2 2.4 11.4 3.4 9.5 C4.2 8.2 6.4 8.7 8.3 10.9 L9.8 13.9 Z",
      "M16.2 13.9 C19.5 13.2 21.6 11.4 20.6 9.5 C19.8 8.2 17.6 8.7 15.7 10.9 L14.2 13.9 Z",
      "M9.3 13.9 C8.6 10.4 9.7 7.0 12.0 5.8 C14.3 7.0 15.4 10.4 14.7 13.9 Z",
    ]) {
      svg.appendChild(createSvgNode("path", {
        d, fill: petalIvory, stroke: dark, "stroke-width": "0.85", "stroke-linejoin": "round",
      }));
    }
    // Front alternating rose acanthus collar petals
    for (const d of [
      "M7.3 13.9 C7.0 11.4 8.0 10.2 9.4 10.4 C10.4 10.6 11.1 11.9 11.3 13.9 Z",
      "M16.7 13.9 C17.0 11.4 16.0 10.2 14.6 10.4 C13.6 10.6 12.9 11.9 12.7 13.9 Z",
    ]) {
      svg.appendChild(createSvgNode("path", {
        d, fill: meta.accent, stroke: dark, "stroke-width": "0.8", "stroke-linejoin": "round",
      }));
    }
    // Central 4-petal golden flower fleuron rosette crowning the abacus
    svg.appendChild(createSvgNode("path", {
      d: "M12 1.2 L13.3 2.6 L14.9 3.6 L13.3 4.6 L12 6.0 L10.7 4.6 L9.1 3.6 L10.7 2.6 Z",
      fill: gold, stroke: dark, "stroke-width": "0.8", "stroke-linejoin": "round",
    }));
    svg.appendChild(createSvgNode("circle", { cx: "12", cy: "3.6", r: "0.8", fill: meta.color }));
  }

  return svg;
}

function createPlayerNameNode(entity, { iconSize = 17, showDifficultyLabel = false } = {}) {
  const name = String((entity && (entity.name || entity.displayName || entity.label)) || "Merchant");
  if (!entity || !entity.isBot) {
    return document.createTextNode(name);
  }
  const diff = normalizeBotDifficulty(entity.botDifficulty);
  const span = document.createElement("span");
  span.className = "player-name-with-capital";
  span.style.display = "inline-flex";
  span.style.alignItems = "center";
  span.style.gap = "3px";
  span.style.whiteSpace = "nowrap";
  span.appendChild(document.createTextNode(name));
  span.appendChild(createColumnCapitalIconNode(diff, iconSize));
  if (showDifficultyLabel) {
    const meta = BOT_DIFFICULTY_META[diff];
    span.appendChild(document.createTextNode(`(${meta.shortLabel})`));
  }
  return span;
}

function getChronicleSenderColor(colorId) {
  if (colorId && DIE_SYMBOL_COLORS[colorId]) return DIE_SYMBOL_COLORS[colorId];
  return getPlayerHexColor(colorId);
}

function getViewerPlayer(gs) {
  if (!gs || !Array.isArray(gs.players)) return null;
  const idx = gs.viewerPlayerIndex;
  if (typeof idx !== "number" || idx < 0 || idx >= gs.players.length) return null;
  return gs.players[idx] || null;
}

function getFastCountdownRemainingSec(gs) {
  if (!gs || gs.speedMode !== "fast" || gs.phase === "finished" || gs.nextTimeoutAt === null || gs.nextTimeoutAt === undefined) {
    return null;
  }
  const raw = gs.nextTimeoutAt;
  let deadlineMs = NaN;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    deadlineMs = raw > 1e12 ? raw : raw * 1000;
  } else {
    const rawStr = String(raw).trim();
    if (/^\d+(?:\.\d+)?$/.test(rawStr)) {
      const num = Number(rawStr);
      deadlineMs = num > 1e12 ? num : num * 1000;
    } else {
      deadlineMs = Date.parse(rawStr);
    }
  }
  if (!Number.isFinite(deadlineMs)) return null;
  return Math.max(0, (deadlineMs - Date.now()) / 1000);
}

function formatCountdownSeconds(totalSeconds) {
  const s = Math.max(0, Math.ceil(Number(totalSeconds) || 0));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
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
  authErrorBanner: null,
  activeTab: "portal", // "portal" | "tabletop" | "rulebook" | "profile" | "completed_games"
  authMode: "login", // "login" | "register"
  games: [],
  leaderboard: [],
  completedGames: [],
  completedGamesLoading: false,
  shownFinishModalGameIds: new Set(),
  botPersonas: [],
  referenceCatalog: [],
  cardsCatalog: null,
  cardsCatalogLoading: false,
  cardsCatalogError: null,
  rulebookCatalogFilters: {
    marketTrack: "All",
    influenceCategory: "All",
    missionFaction: "All",
    missionKind: "All",
    encounterDeck: "All",
    encounterFaction: "All",
  },
  rulebookSection: "overview",
  rulebookSearch: "",
  currentGameId: null,
  gameSummary: null,
  gameState: null,
  boardViewMode: "auto", // "auto" | "rome" | "market" | "both"
  cartPanelTab: "cart", // "cart" | "navigate"
  inspectedCell: "C3",
  collapsedSections: {
    clockBoard: false,
    merchantsInRome: false,
    factionStandings: false,
  },
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
  promptedMissionOverflowId: null,
  highlightedMarketTrack: null,
  swappedMissionStackIds: new Set(),
  shownScoutIds: new Set(),
  shownScoutKeys: new Set(),
  _actionQueuePromise: Promise.resolve(),
  _pendingActionCount: 0,
  pollTimer: null,
  _lastTabletopPollJson: null,
  _lastPortalPollJson: null,
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
  chronicleDraftText: "",
  armedDieAction: null,
  lastAutoScrolledEncounterKey: null,
  portalDraftName: "",
  portalMaxPlayers: 3,
  portalBotCount: 2,
  portalInviteMode: "open",
  portalInvitedUsernames: "",
  pendingInviteGameId: null,
  highlightedLobbyId: null,
  botDifficulties: BOT_DIFFICULTIES.map((id) => ({ ...BOT_DIFFICULTY_META[id] })),
  portalBotStrategies: ["balanced", "luxury", "aggressive", "faction", "opportunist"],
  portalBotDifficulties: ["ionic", "ionic", "ionic", "ionic", "ionic"],
  portalSpeedMode: "normal",
  portalTurnTimeLimitMinutes: 6,
  tutorialDismissedSteps: new Set(),
  tutorialMarketBoughtAny: false,
  tutorialLastScoutedCoord: null,
  spectatorAutoPlay: false,
  _spectatorStepInFlight: false,
  _lastExpiredDeadlineTriggered: null,
  countdownTimer: null,
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
 * Fetch and cache the static 270-card Rulebook catalog JSON once.
 */
function ensureCardsCatalogLoaded() {
  if (appState.cardsCatalog || appState.cardsCatalogLoading) {
    return appState.cardsCatalogPromise || Promise.resolve(appState.cardsCatalog);
  }
  appState.cardsCatalogLoading = true;
  appState.cardsCatalogError = null;
  const p = fetch("./data/cards_catalog.json?v=62")
    .then((resp) => {
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} loading card catalog`);
      }
      return resp.json();
    })
    .then((data) => {
      appState.cardsCatalog = data;
      appState.cardsCatalogLoading = false;
      appState.cardsCatalogError = null;
      renderApp();
      return data;
    })
    .catch((err) => {
      appState.cardsCatalogLoading = false;
      appState.cardsCatalogError = err && err.message ? err.message : "Failed to load cards catalog.";
      renderApp();
      return null;
    });
  appState.cardsCatalogPromise = p;
  return p;
}

/**
 * Normalize Rome map cell IDs (e.g. legacy Roman row suffix I..VI -> 1..6) to match backend logic.
 */
function normalizeCellIdClient(cell) {
  if (!cell || typeof cell !== "string") return cell || null;
  const s = cell.trim().toUpperCase();
  if (s.length >= 2 && ["A", "B", "C", "D", "E", "F", "G"].includes(s[0])) {
    const rest = s.slice(1);
    if (["1", "2", "3", "4", "5", "6"].includes(rest)) {
      return `${s[0]}${rest}`;
    }
    const romanMap = { I: "1", II: "2", III: "3", IV: "4", V: "5", VI: "6" };
    if (romanMap[rest]) {
      return `${s[0]}${romanMap[rest]}`;
    }
  }
  return cell;
}

/**
 * Measure rendered rival name labels in Faction Standings and abbreviate overflowing names with a single dot.
 */
function abbreviateSingleDotRivalNames() {
  if (typeof document === "undefined") return;
  const labels = document.querySelectorAll(".faction-standing-rival-label");
  labels.forEach((lbl) => {
    const full = String(lbl.getAttribute("data-full-name") || lbl.textContent || "").trim();
    if (!full) return;
    lbl.textContent = full;
    if (!lbl.getClientRects().length || lbl.clientWidth <= 0) return;
    const nameWrap = lbl.parentElement;
    const line = lbl.closest(".faction-standing-rival-line");
    const fits = () => {
      if (lbl.scrollWidth > lbl.clientWidth + 0.5) return false;
      if (nameWrap && nameWrap.scrollWidth > nameWrap.clientWidth + 0.5) return false;
      if (line && line.scrollWidth > line.clientWidth + 0.5) return false;
      return true;
    };
    if (fits()) return;
    let cut = full.length - 1;
    while (cut >= 1) {
      lbl.textContent = `${full.slice(0, cut).trimEnd()}.`;
      if (fits()) break;
      cut -= 1;
    }
  });
}

/**
 * List rival merchants on the viewer's current normalized Rome cell eligible for Casus Belli PvP combat.
 */
function getEligibleCasusBelliPvpTargets(gs, viewer) {
  if (!gs || !viewer) return [];
  const myCell = normalizeCellIdClient(viewer.position);
  if (!myCell) return [];
  return (gs.players || []).filter((cand) => {
    if (!cand || cand.index === viewer.index) return false;
    if (cand.eliminated || cand.exitedRome || cand.nightEnded) return false;
    return normalizeCellIdClient(cand.position) === myCell;
  });
}

const MAX_ACTIVE_MISSIONS = 5;

function areAllMissionsSoothsayer(missions) {
  return (
    Array.isArray(missions) &&
    missions.length > MAX_ACTIVE_MISSIONS &&
    missions.every((m) => (m.source || "starting") === "soothsayer")
  );
}

function hasMissionOverflow(player, gsOverride = null) {
  if (!player) return false;
  if (player.pendingMissionOverflow) return true;
  const gs = gsOverride || appState.gameState;
  if (gs && (gs.phase === "setup_discard" || gs.phase === "finished")) return false;
  return Array.isArray(player.missions) && player.missions.length > MAX_ACTIVE_MISSIONS;
}

function isMissionCancelableClient(player, m) {
  if (!m) return false;
  if ((m.source || "starting") !== "soothsayer") return true;
  return areAllMissionsSoothsayer(player ? player.missions : []);
}

function getMissionOverflowId(player) {
  if (!player) return null;
  if (player.pendingMissionOverflow && player.pendingMissionOverflow.id) {
    return String(player.pendingMissionOverflow.id);
  }
  const ms = Array.isArray(player.missions) ? player.missions : [];
  if (ms.length <= MAX_ACTIVE_MISSIONS) return null;
  return `movf_${ms.length}_${ms.map((m) => m.id).join("_")}`;
}

function hasPlayerBlockingPrompt(player, includeTop3 = false, gsOverride = null) {
  if (!player) return false;
  if (
    (Array.isArray(player.pendingNpcOffer)
      ? player.pendingNpcOffer.length > 0
      : Boolean(player.pendingNpcOffer)) ||
    (Array.isArray(player.pendingCartOverflow)
      ? player.pendingCartOverflow.length > 0
      : Boolean(player.pendingCartOverflow)) ||
    (Array.isArray(player.pendingMarketReward)
      ? player.pendingMarketReward.length > 0
      : Boolean(player.pendingMarketReward)) ||
    hasMissionOverflow(player, gsOverride)
  ) {
    return true;
  }
  if (
    includeTop3 &&
    (Array.isArray(player.pendingTop3Reorder)
      ? player.pendingTop3Reorder.length > 0
      : Boolean(player.pendingTop3Reorder))
  ) {
    return true;
  }
  return false;
}

/**
 * Validate whether Casus Belli can currently be played (NPC pre_decision OR Turn 2+ proactive PvP).
 */
function getCasusBelliProactiveDisabledReason(gs, viewer) {
  if (!gs || !viewer) return "No active game.";
  const pend = gs.pendingEncounter;
  if (pend) {
    const pStage = pend.stage || "pre_decision";
    if (
      pStage === "pre_decision" &&
      !pend.isPvp &&
      pend.playerIndex === viewer.index &&
      pend.interveningPlayerIndex == null &&
      !pend.canInitiateCombat &&
      !pend.combatMandatory
    ) {
      return null;
    }
    return "Casus Belli can only be played during an initial NPC Encounter decision when combat is not already available, or outside an Encounter on your Night Delivery turn (Turn 2+).";
  }
  if (gs.phase !== "delivery" || gs.activePlayerIndex !== viewer.index) {
    return "Casus Belli can only initiate PvP combat on your Night Delivery turn.";
  }
  if ((Number(gs.turn) || 1) <= 1) {
    return "Casus Belli cannot be used on Turn 1 to initiate combat with another merchant.";
  }
  const myCell = normalizeCellIdClient(viewer.position);
  if (viewer.exitedRome || viewer.nightEnded || viewer.eliminated || viewer.turnStep === "done" || !myCell) {
    return "Your Cart must be active inside Rome to initiate Casus Belli PvP combat.";
  }
  if (viewer.transactedThisTurn || viewer.gambledThisTurn) {
    return "Casus Belli exhausts your Transaction for this turn, and you have already transacted or gambled.";
  }
  if (hasPlayerBlockingPrompt(viewer, true, gs)) {
    return hasMissionOverflow(viewer, gs)
      ? "Cancel 1 mission (5-mission limit exceeded) before playing Casus Belli."
      : "Resolve your active Cart/Market prompt before playing Casus Belli.";
  }
  const targets = getEligibleCasusBelliPvpTargets(gs, viewer);
  if (targets.length === 0) {
    return `No eligible opponent merchant is present in ${myCell} to challenge with Casus Belli.`;
  }
  return null;
}

function getAbbrevMerchantName(player) {
  const raw = String((player && (player.name || player.displayName || player.label)) || "Player").trim();
  if (!raw) return "Player";
  const firstWord = raw.split(/\s+/)[0];
  return firstWord.length > 8 ? `${firstWord.slice(0, 7)}…` : firstWord;
}

function createSectionCollapseToggleBtn(sectionKey, isCollapsed, labelText) {
  return el("button", {
    type: "button",
    className: "collapse-toggle-btn",
    "data-collapse-section": sectionKey,
    title: labelText,
    "aria-label": labelText,
    text: isCollapsed ? "+" : "−",
    onClick: (e) => {
      e.stopPropagation();
      if (!appState.collapsedSections) {
        appState.collapsedSections = { clockBoard: false, merchantsInRome: false, factionStandings: false };
      }
      appState.collapsedSections[sectionKey] = !Boolean(appState.collapsedSections[sectionKey]);
      renderApp();
    },
  });
}

function getActiveDemandKind(pend) {
  if (!pend || (pend.stage && pend.stage !== "pre_decision")) return null;
  if (pend.combatMandatory) return null;
  const rType = pend.reaction || pend.reactionType || "";
  if (rType !== "demand" && rType !== "demand_strict") return null;
  const c = pend.card || {};
  const actionTxt = String(c.actionText || "").trim();
  if (actionTxt.startsWith("?")) return null;
  if (c.mission || !actionTxt) return null;
  if (actionTxt.includes("(d)") || actionTxt.toLowerCase().includes("denari")) return "cash";
  return "goods";
}

function isSpontaneousAnytimeInfluenceCard(card) {
  if (!card) return false;
  const cname = String(card.name || "");
  const eff = String(card.effectCode || "");
  return (
    ["Patron", "Cartwright", "Thug", "Wine Forger", "Procurer"].includes(cname) ||
    cname.includes("Favor") ||
    [
      "patron_caracalla_domna",
      "patron_geta_aurelius",
      "permanent_storage_plus_2",
      "free_guard_1r",
      "wine_forger",
      "buy_from_deck_uncommon",
      "buy_any_good_common",
    ].includes(eff) ||
    eff.startsWith("faction_favor_")
  );
}

function getInfluenceCardPlayability(gs, viewer, card) {
  const cName = String((card && card.name) || "");
  const effCode = String((card && card.effectCode) || "");
  const effTxt = String((card && card.effectText) || "").toLowerCase();
  const res = {
    playable: false,
    spontaneousAnytime: false,
    mode: "normal",
    badgeText: null,
    badgePositive: false,
    disabledReason: null,
  };
  if (!gs || !viewer || !card) return res;
  if (["setup_discard", "setup_climate", "finished"].includes(gs.phase)) return res;

  const pend = gs.pendingEncounter || null;
  const pendStage = pend ? pend.stage || "pre_decision" : null;
  const isViewerParticipant = Boolean(
    pend && (pend.playerIndex === viewer.index || pend.interveningPlayerIndex === viewer.index)
  );
  const isViewerPrimaryEnc = Boolean(
    pend && pend.playerIndex === viewer.index && pend.interveningPlayerIndex == null
  );
  const isMyDeliveryActive = Boolean(
    gs.phase === "delivery" &&
      gs.activePlayerIndex === viewer.index &&
      Boolean(viewer.position) &&
      !viewer.exitedRome &&
      !viewer.nightEnded &&
      !viewer.eliminated &&
      viewer.turnStep !== "done" &&
      !pend &&
      !hasPlayerBlockingPrompt(viewer, true, gs)
  );

  if (cName === "Twist Of Fate") {
    res.mode = "twist";
    const okStage =
      isViewerParticipant &&
      [
        "combat_pre_strike_post_roll",
        "combat_post_roll",
        "driver_fate_post_roll",
        "chart_post_roll",
        "demand_post_roll",
        "gamble_post_roll",
      ].includes(pendStage) &&
      getEligibleRerollTargets(pend).length > 0;
    if (okStage) {
      res.playable = true;
    } else {
      res.badgeText = "⚡ Reactive on Die Rolls";
      res.disabledReason = "Twist Of Fate can only be played right after a die roll.";
    }
    return res;
  }

  if (pend && pendStage === "combat_pre_strike_post_roll") {
    res.badgeText = "⚔️ Pre-Strike (Twist Only)";
    res.disabledReason = "Only Twist Of Fate may be played during the Sagittae pre-roll strike window.";
    return res;
  }

  if (isSpontaneousAnytimeInfluenceCard(card)) {
    res.spontaneousAnytime = true;
    res.playable = true;
    if (
      effCode === "buy_any_good_common" ||
      effCode === "buy_from_deck_uncommon" ||
      cName.toLowerCase() === "procurer"
    ) {
      res.mode = "procurer";
    }
    return res;
  }

  if (cName === "Lucky Break") {
    res.mode = "lucky_break";
    const okLucky =
      isViewerParticipant &&
      ["driver_fate_post_roll", "chart_post_roll"].includes(pendStage) &&
      pend.chartType !== "soothsayer";
    if (okLucky) {
      res.playable = true;
    } else {
      res.badgeText = "⚡ Reactive on Chart Rolls";
      res.disabledReason =
        "Lucky Break can only be played after rolling on the Death, Angry Mob, or Theater Troupe chart.";
    }
    return res;
  }

  if (cName.includes("Match Fixing") || effCode === "match_fixing") {
    const mfActive = Boolean(viewer.turnEffects && viewer.turnEffects.matchFixing);
    res.badgeText = mfActive ? "✨ Match Fixing Active" : "🏟️ Play in Gamble UI";
    res.badgePositive = mfActive;
    res.disabledReason = "Match Fixing can only be played inside the Stadium Gambling modal on a Gambling tile.";
    return res;
  }

  if (cName.includes("Shortcut") || effCode === "shortcut") {
    res.mode = "shortcut";
    const scReady = Boolean(viewer.turnEffects && viewer.turnEffects.shortcut);
    if (isMyDeliveryActive && Number(viewer.movesRemaining || 0) > 0 && !scReady) {
      res.playable = true;
    } else {
      res.badgeText = scReady ? "✨ Shortcut Readied" : "🛣️ Play When Moving";
      res.badgePositive = scReady;
      res.disabledReason = scReady
        ? "Shortcut is already readied for your move this turn."
        : "Shortcut can only be played on your Night Delivery turn when you have movement remaining.";
    }
    return res;
  }

  if (cName === "Gladiator's Intervention" || cName === "Flying Chamber Pot") {
    if (isViewerParticipant && pendStage === "combat_post_roll") {
      res.playable = true;
    } else {
      res.badgeText = "⚔️ Reactive After Combat Roll";
      res.disabledReason = `${cName} is a reactive card — play it after rolling during an active Combat.`;
    }
    return res;
  }

  if (cName === "Mercenary Ambush" || cName === "Distraction") {
    const okCombatPre =
      isViewerParticipant &&
      (pendStage === "combat_consumable_pre_roll" ||
        (pendStage === "pre_decision" &&
          (pend.canInitiateCombat || pend.combatMandatory || pend.combatThreatened)));
    if (okCombatPre) {
      res.playable = true;
    } else {
      res.badgeText = "⚔️ Reactive Before Combat Roll";
      res.disabledReason = `${cName} is a reactive card — play it before rolling when an Encounter with Combat is active.`;
    }
    return res;
  }

  if (cName === "Supplicant" || cName === "Minor Supplicant") {
    if (isViewerPrimaryEnc && pendStage === "pre_decision") {
      res.playable = true;
    } else {
      res.badgeText = "🙏 Reactive in Encounter";
      res.disabledReason = `${cName} is a reactive card — play it during your active Encounter before choosing an option.`;
    }
    return res;
  }

  if (cName === "Man Of The People") {
    if (
      isViewerPrimaryEnc &&
      ["chart_pre_roll", "chart_post_roll"].includes(pendStage) &&
      pend.chartType === "mob"
    ) {
      res.playable = true;
    } else {
      res.badgeText = "🔥 Reactive on Angry Mob";
      res.disabledReason = "Man Of The People is a reactive card — play it when an Angry Mob encounter occurs.";
    }
    return res;
  }

  if (cName === "Dramaturge") {
    if (
      isViewerPrimaryEnc &&
      ["chart_pre_roll", "chart_post_roll"].includes(pendStage) &&
      pend.chartType === "theater"
    ) {
      res.playable = true;
    } else {
      res.badgeText = "🎭 Reactive on Theater";
      res.disabledReason = "Dramaturge is a reactive card — play it when a Theater Troupe encounter occurs.";
    }
    return res;
  }

  if (cName === "Trained Dog") {
    if (isViewerPrimaryEnc && getActiveDemandKind(pend) === "cash") {
      res.playable = true;
    } else {
      res.badgeText = "🐕 Reactive on Cash Demand";
      res.disabledReason = "Trained Dog is a reactive card — play it during a non-optional Cash Demand encounter.";
    }
    return res;
  }

  if (cName.includes("Plea")) {
    if (isViewerPrimaryEnc && getActiveDemandKind(pend) === "goods") {
      res.playable = true;
    } else {
      res.badgeText = "📜 Reactive on Goods Demand";
      res.disabledReason = "Plea is a reactive card — play it during a non-optional Goods Demand encounter.";
    }
    return res;
  }

  if (cName === "Casus Belli" || effCode === "casus_belli") {
    res.mode = "casus_belli";
    const cbReason = getCasusBelliProactiveDisabledReason(gs, viewer);
    if (!cbReason) {
      res.playable = true;
    } else {
      res.disabledReason = cbReason;
      if (pend || gs.phase !== "delivery" || gs.activePlayerIndex !== viewer.index) {
        res.badgeText = "⚔️ Play in Non-Combat Enc / PvP";
      }
    }
    return res;
  }

  if (cName === "Make Haste" || effCode === "move_twice") {
    const activeMH = Boolean(viewer.turnEffects && viewer.turnEffects.makeHasteExtraTransact);
    if (isMyDeliveryActive) {
      res.playable = true;
    } else {
      res.badgeText = activeMH ? "✨ Make Haste Active" : "⚡ Play on Delivery Turn";
      res.badgePositive = activeMH;
      res.disabledReason =
        "Make Haste can only be played on your Night Delivery turn while your Cart is active on the city board.";
    }
    return res;
  }

  if (cName === "Puffery" || effCode === "increase_own_sale_scarcity") {
    if (isMyDeliveryActive) {
      res.playable = true;
    } else {
      res.badgeText = "📈 Play on Delivery Turn";
      res.disabledReason =
        "Puffery can only be played on your Night Delivery turn while your Cart is active on the city board.";
    }
    return res;
  }

  if (
    effCode.startsWith("reorder_top_3") ||
    cName.toLowerCase().includes("informants") ||
    effTxt.includes("look at the top three")
  ) {
    res.mode = "top3";
  } else if (cName === "Prophecy" || effCode === "trigger_soothsayer") {
    res.mode = "prophecy";
  }

  if (gs.activePlayerIndex === viewer.index && !pend && !hasPlayerBlockingPrompt(viewer, true, gs)) {
    res.playable = true;
  } else {
    res.badgeText = "⏳ Play on Your Turn";
    res.disabledReason = "Resolve the current encounter or wait for your turn to play this card.";
  }
  return res;
}

/**
 * Open the target-selection modal for initiating proactive Casus Belli PvP combat on the viewer's Rome cell.
 */
function openCasusBelliPvpModal(gs, viewer, card) {
  if (!gs || !viewer || !card) return;
  const targets = getEligibleCasusBelliPvpTargets(gs, viewer);
  if (targets.length === 0) {
    showToast("No eligible rival merchant is on your Rome cell to challenge.", true);
    return;
  }
  const myCell = normalizeCellIdClient(viewer.position) || "Rome";
  showModal(
    `⚔️ Casus Belli — Challenge Merchant in ${myCell}`,
    el(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "0.75rem" } },
      el("p", {
        style: { margin: "0", fontSize: "0.86rem", lineHeight: "1.45", color: "var(--text-main)" },
        text: "Choose a rival merchant on your neighborhood tile to challenge in PvP Combat. This uses your Transaction for the turn. If you win, you claim Spoils (up to 3d, 1 Good, 1 Mission, or 1 Influence Card from the loser) before wounds/armor/guard checks apply!",
      }),
      ...targets.map((t) => {
        const tGoods = (t.cart && t.cart.goods) || [];
        const tGuards = (t.cart && t.cart.guards) || [];
        const armorWounds = Number(t.driverWounds || 0);
        const armorCount = Array.isArray(t.armor) ? t.armor.length : 0;
        return el(
          "button",
          {
            type: "button",
            className: "btn btn-crimson",
            style: {
              textAlign: "left",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: "0.2rem",
              padding: "0.65rem 0.85rem",
            },
            onClick: () => {
              closeModal();
              sendGameAction({
                type: "play_influence",
                cardId: card.id,
                targetPlayerIndex: t.index,
                targetId: t.id,
              });
            },
          },
          el("span", {
            style: { fontWeight: "800", fontSize: "0.92rem" },
            text: `⚔️ Challenge ${t.name || "Rival"} (${t.cash ?? 0}d • ${tGoods.length} Good${tGoods.length === 1 ? "" : "s"} • ${tGuards.length} Guard${tGuards.length === 1 ? "" : "s"})`,
          }),
          el("span", {
            style: { fontSize: "0.76rem", opacity: "0.9" },
            text: `Missions: ${(t.missions || []).length} • Influence: ${(t.influence || []).length} • Armor: ${armorCount} • Driver Wounds: ${armorWounds}`,
          })
        );
      }),
      el("button", { type: "button", className: "btn", text: "Cancel", onClick: closeModal })
    )
  );
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
  /(\(SELL_SYM\)|\(BUY_SYM\)|\(COMBAT_ICON\)|\(DECK_ICON\)|\(QUEST_ICON\)|\(M\)|\(T\)|\(GREEN_BAR\)|\(RED_BAR\)|\(R\)|\(r\)|®|🅁|𐆖)/g;

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
 * Builds a compact inline Combat icon node using shrunk-down crossed-gladius artwork (/assets/icons/combat_tier.png).
 */
function createCombatInlineIconNode(extraClass = "") {
  const img = document.createElement("img");
  img.className = `enc-tier-inline-icon combat-tier-icon ${extraClass}`.trim();
  img.src = resolveAssetUrl("/assets/icons/combat_tier.png");
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
  svg.setAttribute("aria-label", "Missiones Deck (Unseen Card)");
  svg.setAttribute("data-hover-title", "Missiones Deck (Draw Top Card Unseen)");

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
  svg.setAttribute("aria-label", "Mission Quest Chest");
  svg.setAttribute("data-hover-title", "Quest Chest (Mission Contract)");

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

/**
 * Builds an inline Green Bar or Red Bar legend chip matching Rome tile edges.
 */
function createEdgeBarLegendChipNode(isGreen) {
  const wrap = document.createElement("span");
  wrap.className = "rulebook-edge-bar-chip";
  wrap.setAttribute(
    "data-hover-title",
    isGreen
      ? "Green Bar Edge — Open Street (passable without Shortcut)"
      : "Red Bar Edge — Barricaded Alley (impassable without Shortcut)"
  );
  const bar = document.createElement("span");
  bar.className = `rulebook-edge-bar-sample ${isGreen ? "edge-green" : "edge-red"}`;
  bar.setAttribute("aria-hidden", "true");
  wrap.appendChild(bar);
  wrap.appendChild(document.createTextNode(isGreen ? "Green Bar" : "Red Bar"));
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
      .replace(/\(M\)/g, "[M]")
      .replace(/\(T\)/g, "[T]")
      .replace(/\(GREEN_BAR\)/g, "Green Bar")
      .replace(/\(RED_BAR\)/g, "Red Bar")
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
    } else if (part === "(M)") {
      const mNode = createMoveActionCircleNode("Move Action (M)");
      mNode.classList.add("rulebook-inline-action-sym");
      parentNode.appendChild(mNode);
    } else if (part === "(T)") {
      const tNode = createTransactionActionCircleNode("Transaction Action (T)");
      tNode.classList.add("rulebook-inline-action-sym");
      parentNode.appendChild(tNode);
    } else if (part === "(GREEN_BAR)") {
      parentNode.appendChild(createEdgeBarLegendChipNode(true));
    } else if (part === "(RED_BAR)") {
      parentNode.appendChild(createEdgeBarLegendChipNode(false));
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

function getEncounterFigureAssetMeta(encStr, placement = "center", dir = null) {
  if (!encStr || encStr === "None") return null;
  const s = String(encStr).trim();
  const normDir = dir ? String(dir).toUpperCase() : null;
  let loc = placement || "center";
  if (normDir) {
    loc = ["NE", "NW", "SE", "SW"].includes(normDir) ? "corner_edge" : "flat_edge";
  }
  const isEdge = loc === "flat_edge" || loc === "corner_edge";
  const isCornerEnc = loc === "corner_edge";
  const isTopCorner = normDir === "NW" || normDir === "NE";
  const isRightCorner = normDir === "NE" || normDir === "SE";
  const isCornerMirror = normDir === "NE" || normDir === "SW";
  const isVert = loc === "flat_edge" && (normDir === "E" || normDir === "W");

  if (s === "mob") {
    return {
      src: !isEdge
        ? "/assets/icons/encounters/mob_center.png"
        : isCornerEnc
        ? isTopCorner
          ? "/assets/icons/encounters/mob_top_corner_edge.png"
          : "/assets/icons/encounters/mob_corner_edge.png"
        : "/assets/icons/encounters/mob_edge.png",
      alt: "Angry Mob",
      isCrowdEdge: isEdge && !isCornerEnc,
      isCornerEnc,
      isCornerWedge: isCornerEnc,
      isCompactCorner: false,
      isCornerMirror: isCornerEnc ? isRightCorner : false,
      isVerticalRotate: isVert,
    };
  }
  if (s === "theater") {
    return {
      src: !isEdge
        ? "/assets/icons/encounters/theater_center.png"
        : isCornerEnc
        ? isTopCorner
          ? "/assets/icons/encounters/theater_top_corner_edge.png"
          : "/assets/icons/encounters/theater_corner_edge.png"
        : "/assets/icons/encounters/theater_edge.png",
      alt: "Theater Troupe",
      isCrowdEdge: isEdge && !isCornerEnc,
      isCornerEnc,
      isCornerWedge: isCornerEnc,
      isCompactCorner: false,
      isCornerMirror: isCornerEnc ? isRightCorner : false,
      isVerticalRotate: isVert,
    };
  }
  if (s === "soothsayer") {
    return {
      src: isEdge ? "/assets/icons/encounters/soothsayer_edge.png" : "/assets/icons/encounters/soothsayer_center.png",
      alt: "Soothsayer",
      isCrowdEdge: false,
      isCornerEnc,
      isCornerWedge: false,
      isCompactCorner: isCornerEnc,
      isSoothsayerCenter: !isEdge,
      isCornerMirror: false,
      isVerticalRotate: false,
    };
  }
  const parts = s.split(/[_:]/);
  const deckType = String(parts[0] || "").toLowerCase();
  const count = Math.max(1, Math.min(4, Number(parts[1]) || 1));
  if (deckType === "patricii") {
    return {
      src: isEdge ? "/assets/icons/encounters/patricii_edge.png" : "/assets/icons/encounters/patricii_center.png",
      alt: `Patricii (${count})`,
      isCrowdEdge: false,
      isCornerEnc,
      isCornerWedge: false,
      isCompactCorner: isCornerEnc,
      isCornerMirror: false,
      isVerticalRotate: false,
    };
  }
  if (deckType === "nefarii" || deckType === "legiones") {
    const fileLoc = loc === "corner_edge" ? "corner_edge" : loc === "flat_edge" ? "flat_edge" : "center";
    return {
      src: `/assets/icons/encounters/${deckType}_${count}_${fileLoc}.png`,
      alt: `${deckType.charAt(0).toUpperCase() + deckType.slice(1)} (${count})`,
      isCrowdEdge: false,
      isCornerEnc,
      isCornerWedge: false,
      isCompactCorner: isCornerEnc && count === 1,
      isCornerMirror,
      isVerticalRotate: count > 1 && isVert,
    };
  }
  return {
    src: isEdge ? "/assets/icons/encounters/patricii_edge.png" : "/assets/icons/encounters/patricii_center.png",
    alt: s,
    isCrowdEdge: false,
    isCornerEnc,
    isCornerWedge: false,
    isCompactCorner: isCornerEnc,
    isCornerMirror: false,
    isVerticalRotate: false,
  };
}

function buildEncounterFigureNodes(encStr, iconClass, opts = {}) {
  const meta = getEncounterFigureAssetMeta(encStr, opts.placement || "center", opts.dir || null);
  if (!meta) return [];
  const classes = [iconClass];
  if (meta.isCornerEnc) classes.push("is-corner-enc");
  if (meta.isCornerWedge) classes.push("is-corner-wedge");
  if (meta.isCompactCorner) classes.push("is-compact-corner");
  if (meta.isSoothsayerCenter) classes.push("is-soothsayer-center");
  if (meta.isCornerMirror) classes.push("is-corner-mirror");
  if (meta.isCrowdEdge) classes.push("is-crowd-edge");
  return [
    el("img", {
      className: classes.filter(Boolean).join(" "),
      src: meta.src,
      alt: meta.alt,
    }),
  ];
}

function renderDynamicEdgeSlotNode(dir, edgeVal, _coord = null) {
  if (!edgeVal) return null;
  let inner = null;
  let hasVerticalEnc = false;
  const tollAmt = parseTollAmount(edgeVal);
  if (edgeVal === "green") {
    inner = el("span", { className: "dyn-edge-bar edge-green" });
  } else if (edgeVal === "red") {
    inner = el("span", { className: "dyn-edge-bar edge-red" });
  } else if (tollAmt > 0) {
    inner = el("span", {
      className: "dyn-edge-toll",
      title: `${tollAmt}(d) Road Toll`,
      text: `${tollAmt}(d)`,
    });
  } else {
    const placement = ["NE", "NW", "SE", "SW"].includes(dir) ? "corner_edge" : "flat_edge";
    const meta = getEncounterFigureAssetMeta(edgeVal, placement, dir);
    const figs = buildEncounterFigureNodes(edgeVal, "dyn-edge-enc-icon", { placement, dir });
    if (figs.length > 0) {
      hasVerticalEnc = Boolean(meta && meta.isVerticalRotate);
      const groupClasses = ["dyn-edge-enc-group"];
      if (hasVerticalEnc) groupClasses.push("is-vertical-edge");
      if (meta && meta.isCornerEnc) groupClasses.push("is-corner-group");
      if (meta && meta.isCornerWedge) groupClasses.push("is-corner-wedge-group");
      inner = el(
        "span",
        {
          className: groupClasses.join(" "),
          title: formatEdgeLabel(edgeVal),
        },
        ...figs
      );
    }
  }
  if (!inner) return null;
  return el(
    "div",
    { className: `dyn-edge-slot dyn-edge-${dir}${hasVerticalEnc ? " has-vertical-enc" : ""}` },
    inner
  );
}

/**
 * Dynamically renders a revealed Rome Tile Card face from its JSON features
 * (edges, sells, buys, encounter, gamble, persistent, refresh, id, coord).
 * Uses a low-saturation copy of the tile back underneath the encounter icons.
 */
function renderDynamicTileCardNode(tile, coord, mode = "board") {
  if (!tile) return null;
  const tileCoord = coord || tile.coord || "B1";
  const edges = tile.edges || {};
  const sells = tile.sells || [];
  const buys = tile.buys || [];
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

  const edgeNodes = dirs.map((d) => renderDynamicEdgeSlotNode(d, edges[d], tileCoord)).filter(Boolean);

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
    el("div", {
      className: "dyn-tile-back-underlay",
      style: { backgroundPosition: getTileBackBackgroundPosition(tileCoord) },
      "aria-hidden": "true",
    }),
    ...edgeNodes,
    tradeBannerNodes.length > 0 ? el("div", { className: "dyn-tile-trade-stack" }, ...tradeBannerNodes) : null,
    centerFigures.length > 0 ? el("div", { className: "dyn-tile-center-enc" }, ...centerFigures) : null,
    bottomLeftNode,
    bottomRightNode
  );
}

/**
 * Renders the back side of an unrevealed tile card (matching the underlying Rome map board square).
 */
function renderDynamicTileBackNode(coord, cell) {
  return el(
    "div",
    {
      className: "dyn-tile-back",
      style: { backgroundPosition: getTileBackBackgroundPosition(coord) },
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
    allSoothsayerOverflow = false,
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
            const viewerCurr = getViewerPlayer(gsCurr);
            if (!viewerCurr) return;
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
            openCancelMissionConfirmModal(m, Boolean(allSoothsayerOverflow));
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
      "Receive 4(d), gain 1 Plautilla Favor (Sapphire), and lose 1 Caracalla Favor (Ruby) (can be played after encounter is revealed)",
    gems: ["Plautilla", "-Caracalla"],
  },
  "Aurelian Favor": {
    effectText:
      "Receive 4(d), gain 1 Aurelian Favor (Amethyst), and lose 1 Caracalla Favor (Ruby) (can be played after encounter is revealed)",
    gems: ["Aurelius", "-Caracalla"],
  },
  "Geta Favor": {
    effectText:
      "Receive 5(d), gain 1 Geta Favor (Emerald), and lose 1 Caracalla Favor (Ruby) (can be played after encounter is revealed)",
    gems: ["Geta", "-Caracalla"],
  },
  "Domna Favor": {
    effectText:
      "Receive 4(d), gain 1 Domna Favor (Diamond), and lose 1 Plautilla Favor (Sapphire) and 1 Aurelian Favor (Amethyst) (can be played after encounter is revealed)",
    gems: ["Domna", "-Plautilla", "-Aurelius"],
  },
  "Caracalla Favor": {
    effectText:
      "Receive 5(d), gain 1 Caracalla Favor (Ruby), and lose 1 Geta Favor (Emerald) and 1 Plautilla Favor (Sapphire) (can be played after encounter is revealed)",
    gems: ["Caracalla", "-Geta", "-Plautilla"],
  },
};

const PATRON_INFLUENCE_SPECS = {
  patron_caracalla_domna: {
    effectText: "Receive 6(d), lose 1 Caracalla Favor (Ruby) and 1 Domna Favor (Diamond)",
    gems: ["-Caracalla", "-Domna"],
  },
  patron_geta_aurelius: {
    effectText: "Receive 6(d), lose 1 Geta Favor (Emerald) and 1 Aurelian Favor (Amethyst)",
    gems: ["-Geta", "-Aurelius"],
  },
};

function getPatronInfluenceSpec(c) {
  if (!c) return null;
  const efc = String(c.effectCode || "").trim();
  if (PATRON_INFLUENCE_SPECS[efc]) {
    return PATRON_INFLUENCE_SPECS[efc];
  }
  const cname = String(c.name || "").trim();
  if (!cname.includes("Patron")) return null;
  const baseId = String(c.id || "").replace(/([0-9]+)[a-z]+$/i, "$1");
  if (baseId === "inf_2") return PATRON_INFLUENCE_SPECS.patron_caracalla_domna;
  if (baseId === "inf_39") return PATRON_INFLUENCE_SPECS.patron_geta_aurelius;
  return null;
}

function getInfluenceCardEffectText(c) {
  if (!c) return "";
  const cname = String(c.name || "").trim();
  if (FACTION_FAVOR_INFLUENCE_SPECS[cname]) {
    return FACTION_FAVOR_INFLUENCE_SPECS[cname].effectText;
  }
  const patronSpec = getPatronInfluenceSpec(c);
  if (patronSpec) {
    return patronSpec.effectText;
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
  const patronSpec = getPatronInfluenceSpec(c);
  if (patronSpec) {
    return patronSpec.gems;
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
  if (cname.includes("Favor") || cname.includes("Patron")) {
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
  return s
    .replace("-1..0", "-1 to 0")
    .replace("0..1", "0-1")
    .replace("<=", "≤ ")
    .replace(">=", "≥ ")
    .replace(/\s+/g, " ");
}

function formatReactionTypeSymbol(rOrType) {
  if (!rOrType) return "!";
  const t = typeof rOrType === "object" ? String(rOrType.type || rOrType.effect || "") : String(rOrType);
  if (t === "combat" && typeof rOrType === "object" && rOrType.ifCarrying) {
    return `${String(rOrType.ifCarrying)} (COMBAT_ICON)`;
  }
  if (t === "combat") return "(COMBAT_ICON)";
  if (t === "no_contraband") return "✓";
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

const ENCOUNTER_REACTION_EXPLAINERS = {
  deck_quest_demand: {
    label: "Deck Quest Demand",
    symbolDesc: "card icon + chest icon + !",
    detail: "draw and accept the top Missiones card (unseen) as a Mission (refuse to suffer Hostile Favor)",
  },
  deck_quest_offer: {
    label: "Optional Deck Quest Offer",
    symbolDesc: "card icon + chest icon + ?",
    detail: "optionally draw and accept the top Missiones card (unseen) as a Mission (decline with no penalty)",
  },
  mission_strict: {
    label: "Strict Printed Mission Demand",
    symbolDesc: "chest icon + !!",
    detail: "accept this card's printed Mission (refusing initiates Combat!)",
  },
  mission_request: {
    label: "Printed Mission Request",
    symbolDesc: "chest icon + !",
    detail: "accept this card's printed Mission (refuse to suffer Hostile Favor)",
  },
  mission_offer: {
    label: "Optional Printed Mission Offer",
    symbolDesc: "chest icon + ?",
    detail: "optionally accept this card's printed Mission (decline with no penalty)",
  },
  mission_bonus: {
    label: "Optional Printed Mission Offer",
    symbolDesc: "chest icon + ?",
    detail: "optionally accept this card's printed Mission (decline with no penalty)",
  },
  demand_strict: {
    label: "Strict Demand (!!)",
    symbolDesc: "!!",
    detail: "fulfill this card's printed demand (refusing initiates Combat!)",
  },
  demand: {
    label: "Demand (!)",
    symbolDesc: "!",
    detail: "fulfill this card's printed demand (refuse to suffer Hostile Favor)",
  },
  offer: {
    label: "Optional Offer (?)",
    symbolDesc: "?",
    detail: "optionally accept this card's friendly offer (decline with no penalty)",
  },
  quest_optional: {
    label: "Optional Offer (?)",
    symbolDesc: "?",
    detail: "optionally accept this card's friendly offer (decline with no penalty)",
  },
  no_contraband: {
    label: "Contraband Inspection Passed",
    symbolDesc: "✓",
    detail: "you carry none of the inspected contraband — pass peacefully with no penalty",
  },
  combat: {
    label: "Mandatory Combat",
    symbolDesc: "crossed swords",
    detail: "hostile reaction — fight using Combat Power!",
  },
};

function inferTierReactionType(tier) {
  if (!tier) return "demand";
  if (tier.reactionType || tier.type) return String(tier.reactionType || tier.type);
  const eff = String(tier.effect || "").trim();
  if (eff.includes("⚔") || eff.includes("(COMBAT_ICON)") || eff.toLowerCase() === "combat") return "combat";
  if (eff === "✓") return "no_contraband";
  if ((eff.includes("(DECK_ICON)") || eff.includes("🃏")) && eff.includes("!")) return "deck_quest_demand";
  if ((eff.includes("(DECK_ICON)") || eff.includes("🃏")) && eff.includes("?")) return "deck_quest_offer";
  if (eff.includes("(QUEST_ICON)") || eff.includes("📦")) {
    if (eff.includes("!!")) return "mission_strict";
    if (eff.includes("?")) return "mission_offer";
    return "mission_request";
  }
  if (eff === "!!") return "demand_strict";
  if (eff === "!") return "demand";
  if (eff === "?") return "offer";
  if (/\(d\)|𐆖|\d+d\b/i.test(eff)) return "cash_reward";
  return eff;
}

function getEncounterReactionInfo(rOrType) {
  const isObj = typeof rOrType === "object" && rOrType !== null;
  const rType = isObj ? inferTierReactionType(rOrType) : String(rOrType || "");
  if (rType === "combat" && isObj && rOrType.ifCarrying) {
    return {
      type: "combat",
      label: `Contraband Inspection (${rOrType.ifCarrying})`,
      symbolDesc: `${rOrType.ifCarrying} + crossed swords`,
      detail: `attacks in Combat if carrying ${rOrType.ifCarrying}; otherwise waves you through safely (✓)`,
    };
  }
  if (rType === "cash_reward") {
    const rewardRaw = (isObj && (rOrType.reward || rOrType.effect)) || "(d)";
    const rewardClean = String(rewardRaw).replace(/\(d\)/gi, "d").replace(/𐆖/g, "d");
    return {
      type: rType,
      label: `Patronage Gift (${rewardClean})`,
      symbolDesc: rewardClean,
      detail: `collect ${rewardClean} from this Patron (and earn Friendly Favor)`,
    };
  }
  const entry = ENCOUNTER_REACTION_EXPLAINERS[rType];
  if (entry) {
    return Object.assign({ type: rType }, entry);
  }
  return {
    type: rType,
    label: rType || "Encounter Tier",
    symbolDesc: rType || "tier icon",
    detail: "resolve this Encounter tier effect",
  };
}

function formatEncounterTierHoverTitle(tier, { isCombatTier, isActive, interactive, canFight, combatMandatory }) {
  const info = getEncounterReactionInfo(tier);
  const condStr = tier && tier.cond ? `Favor ${tier.cond}` : "Reputation Tier";
  if (isCombatTier && interactive) {
    if (tier && tier.ifCarrying && !combatMandatory) {
      return `${condStr} — ${info.label}: ${info.detail}`;
    }
    return canFight
      ? `${condStr} — ${info.label}: Click to Fight in Combat!`
      : `${condStr} — Combat Locked (Not Threatened)`;
  }
  const baseText = `${condStr} — ${info.label}: ${info.symbolDesc} means ${info.detail}.`;
  if (interactive && isActive && !combatMandatory) {
    return `Active Tier (${baseText}) Click to Comply / Accept.`;
  }
  return baseText;
}

function cleanEncounterActionText(rawText) {
  if (!rawText) return "";
  let s = String(rawText).trim();
  if (/^[!?]?\s*:?\s*(?:Accept|Optional)\s+(?:the\s+)?top\s+(?:card\s+of\s+the\s+)?Missiones\b/i.test(s)) {
    return "";
  }
  s = s
    .replace(/\s*•\s*(?:\(DECK_ICON\)|🃏)?(?:\(QUEST_ICON\)|📦)?[!?]:\s*(?:Accept|Optional)\s+top\s+Missiones\s+card\s*\(unseen\)\.?/gi, "")
    .trim();
  return s;
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
  const canFulfillOnCard = Boolean(interactive && !combatMandatory && (onFulfill || (pend && typeof pend === "object")));

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
          reactionType: r.type,
          ifCarrying: r.ifCarrying || null,
          reward: r.reward,
        }))
      : [
          { cond: "≤ -1", effect: "(COMBAT_ICON)", reactionType: "combat" },
          {
            cond: "≥ 0",
            effect: formatReactionTypeSymbol(pend ? pend.reaction || pend.reactionType : "demand"),
            reactionType: (pend && typeof pend === "object" && (pend.reaction || pend.reactionType)) || "demand",
          },
        ];
  const matchedIdx = pend && typeof pend.matchedTierIndex === "number" ? pend.matchedTierIndex : -1;

  const tierCells = tiers.map((t, idx) => {
    const isActive = idx === matchedIdx;
    const isPassedContraband = isActive && pend && (pend.reaction || pend.reactionType) === "no_contraband";
    const rawEff = String(t.effect || "");
    const eff = isPassedContraband
      ? "✓"
      : rawEff
          .replace(/⚔️|⚔/g, "(COMBAT_ICON)")
          .replace(/🃏/g, "(DECK_ICON)")
          .replace(/📦/g, "(QUEST_ICON)");
    const isCombatTier =
      !isPassedContraband &&
      (t.reactionType === "combat" ||
        rawEff.includes("⚔") ||
        eff.includes("(COMBAT_ICON)") ||
        rawEff.toLowerCase() === "combat");
    const clickCls =
      interactive && isCombatTier
        ? canFight
          ? "enc-clickable-section section-combat"
          : "enc-section-locked"
        : canFulfillOnCard && isActive
        ? "enc-clickable-section section-fulfill"
        : "";

    const tierEffectEl = el("div", { className: "phys-enc-tier-effect", text: eff });
    // Clear nested icon titles inside tier cells so hovering any icon shows the tier's full explanation
    tierEffectEl.querySelectorAll("[data-hover-title]").forEach((node) => node.removeAttribute("data-hover-title"));

    return el(
      "div",
      {
        className: `phys-enc-tier-cell ${isActive ? "tier-active" : ""} ${clickCls}`,
        title: isPassedContraband
          ? "Contraband Inspection Passed — your cart carries none of the listed contraband. Click to wave through peacefully."
          : formatEncounterTierHoverTitle(t, {
              isCombatTier,
              isActive,
              interactive,
              canFight,
              combatMandatory,
            }),
        onClick: isCombatTier ? handleCombatClick : canFulfillOnCard && isActive ? handleFulfillClick : null,
      },
      tierEffectEl,
      el("div", { className: "phys-enc-tier-cond", text: t.cond })
    );
  });

  const missionObj = card.mission || null;
  const cleanedActionText = cleanEncounterActionText(card.actionText);
  const rawBodyText = cleanedActionText || formatMissionObjective(missionObj);
  const defaultActionText = normalizeRelativeScarcityText(rawBodyText);

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
          className: `phys-card-bar ${canFulfillOnCard ? "enc-clickable-section section-fulfill" : ""}`,
          title: canFulfillOnCard ? "Click to Comply / Accept Friendly Terms" : "",
          onClick: canFulfillOnCard ? handleFulfillClick : null,
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
          className: `phys-card-body ${canFulfillOnCard ? "enc-clickable-section section-fulfill" : ""}`,
          title: canFulfillOnCard
            ? "Click this section of the card to Comply / Accept Offer / Accept Mission"
            : "",
          onClick: canFulfillOnCard ? handleFulfillClick : null,
        },
        el(
          "div",
          {},
          canFulfillOnCard
            ? el(
                "div",
                { style: { marginBottom: "4px" } },
                el("span", {
                  className: "enc-click-hint-pill fulfill",
                  text: "👆 Click Section to Comply / Accept",
                })
              )
            : null,
          defaultActionText
            ? el("div", {
                style: { fontWeight: "700" },
                text: defaultActionText,
              })
            : null,
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
  if (gameChanged) {
    appState.spectatorAutoPlay = false;
    appState._spectatorStepInFlight = false;
    appState._lastExpiredDeadlineTriggered = null;
    appState.chronicleDraftText = "";
    appState.tutorialDismissedSteps = new Set();
    appState.tutorialMarketBoughtAny = false;
    appState.tutorialLastScoutedCoord = null;
  }
  const hasHuman = Array.isArray(gs.players) && gs.players.some((p) => !p.isBot);
  if (gs.phase === "finished" || hasHuman) {
    appState.spectatorAutoPlay = false;
  }
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

  // Chronicle of Rome scroll stability: auto-scroll downward unless user intentionally scrolled up
  const logs = Array.isArray(gs.logs) ? gs.logs : [];
  const lastLog = logs.length > 0 ? logs[logs.length - 1] : null;
  const logSig = lastLog
    ? `${logs.length}:${lastLog.seq ?? ""}:${lastLog.season || ""}:${lastLog.turn ?? ""}:${lastLog.senderName || ""}:${lastLog.text || ""}`
    : "0";
  if (gameChanged || appState.chronicleLastGameId !== gameId) {
    appState.chronicleLastGameId = gameId;
    appState.chronicleLastLogSig = logSig;
    appState.chronicleUserScrolled = false;
    appState.chronicleScrollTop = null;
  } else if (appState.chronicleLastLogSig !== null && appState.chronicleLastLogSig !== logSig) {
    appState.chronicleLastLogSig = logSig;
    if (!appState.chronicleUserScrolled) {
      appState.chronicleScrollTop = null;
    }
  } else {
    appState.chronicleLastLogSig = logSig;
  }

  // Clear armed die-card action if encounter ended or card was spent
  if (appState.armedDieAction) {
    const viewer = getViewerPlayer(gs);
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
        appState.chronicleScrollTop = null;
        const logBoxEl = document.getElementById("chronicle-log-box");
        if (logBoxEl) {
          logBoxEl.scrollTop = logBoxEl.scrollHeight;
        }
      }
    },
    { passive: true }
  );
}

function consumeResumeGameId() {
  try {
    if (typeof window.sessionStorage === "undefined") return null;
    const raw = (window.sessionStorage.getItem("nm_resume_game_id") || "").trim();
    window.sessionStorage.removeItem("nm_resume_game_id");
    return /^[a-f0-9]{6,24}$/i.test(raw) ? raw : null;
  } catch (_err) {
    return null;
  }
}

function clearResumeGameId() {
  try {
    if (typeof window.sessionStorage !== "undefined") {
      window.sessionStorage.removeItem("nm_resume_game_id");
    }
  } catch (_err) {}
}

async function hydrateRuntimeAuthConfig() {
  const me = await apiRequest("/api/auth/me");
  appState.googleClientId = me.googleClientId || "";
  if (typeof me.firebaseEnabled === "boolean") {
    appState.serverFirebaseEnabled = me.firebaseEnabled;
  }
  if (me.firebaseConfig && typeof me.firebaseConfig === "object") {
    appState.runtimeFirebaseConfig = me.firebaseConfig;
    await initFirebaseClientIfConfigured();
  }
  return me;
}

async function bootstrap() {
  installChronicleViewportScrollWatcher();
  let hadInviteParam = false;
  try {
    const params = new URLSearchParams(window.location.search || "");
    const rawGameParam = (params.get("game") || "").trim();
    if (rawGameParam && /^[A-Za-z0-9_-]{1,40}$/.test(rawGameParam)) {
      appState.pendingInviteGameId = rawGameParam;
      hadInviteParam = true;
    }
  } catch (_e) {}

  await initFirebaseClientIfConfigured();

  try {
    let me = await hydrateRuntimeAuthConfig();
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
        const resumeGameId = consumeResumeGameId();
        if (resumeGameId && !hadInviteParam && !appState.currentGameId) {
          await openGame(resumeGameId);
        }
      }
    } else {
      clearResumeGameId();
    }
  } catch (err) {
    console.error("[NightMerchant] Bootstrap error.");
  }
  renderApp();
  startPolling();
}

function buildTabletopSnapshotKey(res) {
  if (!res) return "";
  try {
    return JSON.stringify({ summary: res.summary || null, state: res.state || null });
  } catch (_err) {
    return "";
  }
}

async function pollTabletopGameNow() {
  if (!appState.user || appState.user.needsUsernameSetup) return;
  if (appState.activeTab !== "tabletop" || !appState.currentGameId) return;
  if (appState._tabletopPollInFlight || appState._pendingActionCount > 0) return;
  appState._tabletopPollInFlight = true;
  try {
    const res = await apiRequest(`/api/games/${appState.currentGameId}`);
    const snapshotKey = buildTabletopSnapshotKey(res);
    if (snapshotKey && snapshotKey === appState._lastTabletopPollJson) {
      return;
    }
    if (snapshotKey) {
      appState._lastTabletopPollJson = snapshotKey;
    }
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
      appState.spectatorAutoPlay = false;
      appState.currentGameId = null;
      appState.gameSummary = null;
      appState.gameState = null;
      appState._lastTabletopPollJson = null;
      appState.activeTab = "portal";
      await refreshPortalOverview();
      showToast("This game has been terminated.", true);
      renderApp();
    }
  } finally {
    appState._tabletopPollInFlight = false;
  }
}

function scheduleNextSpectatorStep(delayMs = 950) {
  if (appState._spectatorAutoTimer) {
    clearTimeout(appState._spectatorAutoTimer);
    appState._spectatorAutoTimer = null;
  }
  if (!appState.spectatorAutoPlay) return;
  appState._spectatorAutoTimer = setTimeout(() => {
    appState._spectatorAutoTimer = null;
    if (appState.spectatorAutoPlay) {
      triggerSpectatorStep({ silentToast: true });
    }
  }, delayMs);
}

async function triggerSpectatorStep({ silentToast = false } = {}) {
  const gs = appState.gameState;
  const g = appState.gameSummary;
  if (!gs || !g || appState.activeTab !== "tabletop") {
    appState.spectatorAutoPlay = false;
    return;
  }
  const hasHuman = Array.isArray(gs.players) && gs.players.some((p) => !p.isBot);
  if (gs.phase === "finished" || hasHuman) {
    appState.spectatorAutoPlay = false;
    renderApp();
    return;
  }
  if (appState._spectatorStepInFlight) return;
  appState._spectatorStepInFlight = true;
  try {
    await sendGameAction({ type: "spectator_step" }, { silentToast });
  } catch (_err) {
    appState.spectatorAutoPlay = false;
    renderApp();
  } finally {
    appState._spectatorStepInFlight = false;
    const updated = appState.gameState;
    const stillZeroHuman = updated && Array.isArray(updated.players) && !updated.players.some((p) => !p.isBot);
    if (appState.spectatorAutoPlay && updated && updated.phase !== "finished" && stillZeroHuman && appState.activeTab === "tabletop") {
      scheduleNextSpectatorStep(950);
    } else if (appState.spectatorAutoPlay) {
      appState.spectatorAutoPlay = false;
    }
  }
}

function updateFastCountdownDom() {
  const timerEl = document.getElementById("fast-countdown-timer");
  const gs = appState.gameState;
  if (!timerEl || appState.activeTab !== "tabletop") return;
  const remaining = getFastCountdownRemainingSec(gs);
  if (remaining === null) return;
  timerEl.textContent = formatCountdownSeconds(remaining);
  timerEl.classList.toggle("urgent", remaining <= 30);
  if (remaining <= 0 && gs && gs.nextTimeoutAt && appState._lastExpiredDeadlineTriggered !== gs.nextTimeoutAt) {
    appState._lastExpiredDeadlineTriggered = gs.nextTimeoutAt;
    pollTabletopGameNow();
  }
}

function startPolling() {
  if (appState.pollTimer) clearInterval(appState.pollTimer);
  if (appState.countdownTimer) clearInterval(appState.countdownTimer);
  appState.countdownTimer = setInterval(updateFastCountdownDom, 1000);
  appState.pollTimer = setInterval(async () => {
    if (!appState.user || appState.user.needsUsernameSetup) return;
    if (appState.activeTab === "tabletop" && appState.currentGameId) {
      await pollTabletopGameNow();
    } else if (appState.activeTab === "portal") {
      try {
        const portalChanged = await refreshPortalOverview();
        if (!portalChanged) return;
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
  if (!appState.user) return false;
  const data = await apiRequest("/api/portal/overview");
  let portalKey = "";
  try {
    portalKey = JSON.stringify({
      user: data.user || null,
      games: data.games || [],
      leaderboard: data.leaderboard || [],
    });
  } catch (_err) { }
  const changed = !portalKey || portalKey !== appState._lastPortalPollJson;
  if (portalKey) {
    appState._lastPortalPollJson = portalKey;
  }
  if (data.user) {
    appState.user = { ...(appState.user || {}), ...data.user };
  }
  appState.games = data.games || [];
  appState.leaderboard = data.leaderboard || [];
  appState.botPersonas = data.botPersonas || [];
  if (Array.isArray(data.botDifficulties) && data.botDifficulties.length > 0) {
    appState.botDifficulties = data.botDifficulties;
  }
  appState.referenceCatalog = data.referenceCatalog || [];
  if (!appState.selectedRefItem && appState.referenceCatalog.length > 0) {
    appState.selectedRefItem = appState.referenceCatalog[0];
  }
  return changed;
}

function getScoutEntryDedupeKey(si) {
  if (!si || typeof si !== "object") return "";
  const tType = String(si.targetType || "").toLowerCase();
  const tKey = String(si.targetKey || "").trim();
  const turnVal = si.turn !== undefined && si.turn !== null ? String(si.turn) : "";
  const revId = si.revealedData && si.revealedData.id ? String(si.revealedData.id) : "";
  return `${tType}:${tKey}:${turnVal}:${revId}`;
}

function seedSeenScoutIds(state, { reset = false } = {}) {
  if (reset) {
    appState.shownScoutIds.clear();
    appState.shownScoutKeys.clear();
  }
  const vp = getViewerPlayer(state);
  if (!vp || !Array.isArray(vp.scoutedInfo)) return;
  vp.scoutedInfo.forEach((si) => {
    if (si && si.id) appState.shownScoutIds.add(si.id);
    const dk = getScoutEntryDedupeKey(si);
    if (dk) appState.shownScoutKeys.add(dk);
  });
}

function enqueueNewMissionEvents(state) {
  if (!state || !Array.isArray(state.missionEvents)) return;
  if (appState.lastSeenMissionEventSeq === null) {
    appState.lastSeenMissionEventSeq =
      typeof state.lastMissionEventSeq === "number" ? state.lastMissionEventSeq : 0;
    return;
  }
  const viewerIdx = typeof state.viewerPlayerIndex === "number" ? state.viewerPlayerIndex : -1;
  const skipPopups = Boolean(
    appState.user && appState.user.settings && appState.user.settings.skipMissionCompletionPopups
  );
  for (const ev of state.missionEvents) {
    if (ev && typeof ev.seq === "number" && ev.seq > appState.lastSeenMissionEventSeq) {
      appState.lastSeenMissionEventSeq = ev.seq;
      if (viewerIdx >= 0 && ev.playerIndex === viewerIdx && !skipPopups) {
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
          el(
            "strong",
            {
              style: {
                fontFamily: "Cinzel, Georgia, serif",
                fontSize: "1.02rem",
                color: isEliminated ? "#991b1b" : entry.won ? "#6e2119" : "var(--text-main)",
              },
            },
            createPlayerNameNode(entry, { iconSize: 18 })
          ),
          entry.isBot
            ? el("span", {
              className: "badge",
              text: `${BOT_DIFFICULTY_META[normalizeBotDifficulty(entry.botDifficulty)].label} AI`,
            })
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
                  el(
                    "span",
                    {
                      style: {
                        fontWeight: p.userId === user.id ? "800" : "600",
                        color: p.won ? "#6e2119" : "var(--text-main)",
                        fontSize: "0.86rem",
                      },
                    },
                    p.won ? "👑 " : null,
                    createPlayerNameNode(p, { iconSize: 17 })
                  )
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
  const vp = getViewerPlayer(state);

  const finishKey = `${appState.currentGameId || "local"}:finished`;
  if (state.phase !== "finished") {
    appState.shownFinishModalGameIds.delete(finishKey);
  }

  if (vp) {
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

    // 0C. Check if player exceeds the 5 active mission limit and must cancel 1 mission
    if (hasMissionOverflow(vp, state)) {
      if (!appState.activeDiceOverlay) {
        const ovfId = getMissionOverflowId(vp);
        if (ovfId && appState.promptedMissionOverflowId !== ovfId) {
          appState.promptedMissionOverflowId = ovfId;
          openPendingMissionOverflowModal(state, vp);
          return;
        }
      }
      return;
    } else {
      appState.promptedMissionOverflowId = null;
    }

    // 1. Check if a new scouted tile/card was just revealed
    if (Array.isArray(vp.scoutedInfo)) {
      for (let i = vp.scoutedInfo.length - 1; i >= 0; i--) {
        const si = vp.scoutedInfo[i];
        if (!si) continue;
        const dk = getScoutEntryDedupeKey(si);
        const alreadySeen =
          (si.id && appState.shownScoutIds.has(si.id)) ||
          (dk && appState.shownScoutKeys.has(dk));
        if (alreadySeen) {
          if (si.id) appState.shownScoutIds.add(si.id);
          continue;
        }
        if (si.id || dk) {
          if (si.id) appState.shownScoutIds.add(si.id);
          if (dk) appState.shownScoutKeys.add(dk);
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
  } else {
    appState.promptedTop3Id = null;
    appState.promptedCartOverflowId = null;
    appState.promptedMarketRewardId = null;
    appState.promptedNpcOfferId = null;
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
    appState._lastTabletopPollJson = buildTabletopSnapshotKey(res);
    appState.setupDiscardMissions.clear();
    appState.setupDiscardInfluence.clear();
    syncGameUiTransitions(res.state, isSwitchingGame);
    if (isSwitchingGame) {
      appState.marketBoardScrollLeft = 0;
      appState.marketBoardScrollTop = 0;
      appState.climateBoardScrollLeft = 0;
      seedSeenScoutIds(res.state, { reset: true });
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
      const vp = getViewerPlayer(res.state);
      if (vp && vp.position) {
        appState.inspectedCell = vp.position;
      } else if (isSwitchingGame) {
        const focusP = res.state.players[res.state.activePlayerIndex] || res.state.players[0];
        if (focusP && focusP.position) {
          appState.inspectedCell = focusP.position;
        }
      }
    }
    appState.activeTab = "tabletop";
    renderApp();
    checkPostActionModals(res.state);
  } catch (err) {
    showToast(err.message, true);
  }
}

function formatTileScoutSummaryClient(tile, coord) {
  if (!tile) return String(coord || "");
  const sellsList = Array.isArray(tile.sells) && tile.sells.length > 0
    ? tile.sells.map((s) => `${s.category} (${formatTileModifier(s.modifier)})`).join(", ")
    : "None";
  const buysList = Array.isArray(tile.buys) && tile.buys.length > 0
    ? ` | Forum Sells [${tile.buys.map((b) => `${b.category} (${formatTileModifier(b.modifier)})`).join(", ")}]`
    : "";
  const enc = tile.encounter || "No center encounter";
  return `${tile.id || coord || "Tile"}: Buys [${sellsList}]${buysList} | Encounter: ${enc} | Gamble: ${tile.gamble ? "Yes" : "No"}`;
}

function executeTileScoutAction(gs, viewer, rawCoord) {
  const coord = String(rawCoord || "").trim().toUpperCase();
  if (!coord) return Promise.resolve();
  const isEntryPhase = Boolean(gs && gs.phase === "delivery_entry");
  const actionPayload = isEntryPhase
    ? { type: "initial_scout", targetType: "tile", cell: coord }
    : { type: "delivery_scout", targetType: "tile", targetKey: coord };

  const cell = gs && gs.romeBoard ? gs.romeBoard[coord] : null;
  const nextTile = cell && cell.nextTile ? cell.nextTile : null;
  if (!viewer || viewer.scoutedThisTurn || !nextTile) {
    closeModal();
    return sendGameAction(actionPayload);
  }

  const optTurn = Number((gs && gs.turn) || 1);
  const optSi = {
    id: `opt_scout_${coord}_${optTurn}_${Date.now()}`,
    turn: optTurn,
    targetType: "tile",
    targetKey: coord,
    label: isEntryPhase ? `Initial Scout (${coord})` : `Tile Stack ${coord}`,
    summary: formatTileScoutSummaryClient(nextTile, coord),
    revealedData: nextTile,
  };
  const optKey = getScoutEntryDedupeKey(optSi);
  appState.shownScoutIds.add(optSi.id);
  if (optKey) appState.shownScoutKeys.add(optKey);

  const prevScouted = Boolean(viewer.scoutedThisTurn);
  const prevScoutedList = Array.isArray(viewer.scoutedInfo) ? viewer.scoutedInfo.slice() : [];
  const prevInspected = appState.inspectedCell;
  const prevTutorialCoord = appState.tutorialLastScoutedCoord;

  viewer.scoutedThisTurn = true;
  viewer.scoutedInfo = [...prevScoutedList, optSi];
  appState.inspectedCell = coord;
  appState.tutorialLastScoutedCoord = coord;

  renderApp();
  openScoutResultModal(optSi);

  return sendGameAction(actionPayload, {
    optimisticRollback: () => {
      appState.shownScoutIds.delete(optSi.id);
      if (optKey) appState.shownScoutKeys.delete(optKey);
      viewer.scoutedThisTurn = prevScouted;
      viewer.scoutedInfo = prevScoutedList;
      appState.inspectedCell = prevInspected;
      appState.tutorialLastScoutedCoord = prevTutorialCoord;
      closeModal();
      renderApp();
    },
  });
}

function sendGameAction(actionPayload, options = {}) {
  if (!appState.currentGameId) return Promise.resolve();
  const prevQueue = appState._actionQueuePromise;
  appState._pendingActionCount = (appState._pendingActionCount || 0) + 1;
  const runAction = async () => {
    try {
      if (!appState.currentGameId) return;
      const silentToast = Boolean(options && options.silentToast);
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
        appState._lastTabletopPollJson = buildTabletopSnapshotKey(res);
        if (actType === "market_buy") {
          appState.tutorialMarketBoughtAny = true;
        } else if (actType === "initial_scout" && actionPayload.cell) {
          appState.tutorialLastScoutedCoord = String(actionPayload.cell);
        } else if (actType === "delivery_scout" && actionPayload.targetType === "tile" && actionPayload.targetKey) {
          appState.tutorialLastScoutedCoord = String(actionPayload.targetKey);
        }
        syncGameUiTransitions(res.state, false);
        enqueueNewNpcEvents(res.state, false);
        enqueueNewDiceEvents(res.state);
        enqueueNewMissionEvents(res.state);
        if (res.message && !silentToast) showToast(res.message, false);
        if (actType === "delivery_scout" && actionPayload.targetType === "tile" && actionPayload.targetKey) {
          appState.inspectedCell = actionPayload.targetKey;
        } else if (actType === "initial_scout" && actionPayload.cell) {
          appState.inspectedCell = actionPayload.cell;
        } else if (res.state && res.state.players) {
          const vp = getViewerPlayer(res.state);
          if (vp && vp.position) {
            appState.inspectedCell = vp.position;
          }
        }
        renderApp();
        checkPostActionModals(res.state);
      } catch (err) {
        if (options && typeof options.optimisticRollback === "function") {
          options.optimisticRollback();
        }
        showToast(err.message, true);
      }
    } finally {
      appState._pendingActionCount = Math.max(0, (appState._pendingActionCount || 1) - 1);
    }
  };
  const nextRun =
    appState._pendingActionCount === 1 || !prevQueue
      ? runAction()
      : prevQueue.catch(() => {}).then(runAction);
  appState._actionQueuePromise = nextRun;
  return nextRun;
}

async function sendChronicleChatMessage(rawText, { keepFocus = true } = {}) {
  if (!appState.currentGameId || appState._chatSendInFlight) return;
  const rawDraft = rawText !== undefined && rawText !== null ? String(rawText) : String(appState.chronicleDraftText ?? "");
  const cleaned = rawDraft.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    showToast("Enter a chat message first.", true);
    return;
  }
  if (cleaned.length > 300) {
    showToast("Chat message cannot exceed 300 characters.", true);
    return;
  }
  appState._chatSendInFlight = true;
  try {
    const res = await apiRequest(`/api/games/${appState.currentGameId}/chat`, "POST", { message: cleaned });
    appState.chronicleDraftText = "";
    appState.chronicleUserScrolled = false;
    appState.chronicleScrollTop = null;
    if (res && res.summary) appState.gameSummary = res.summary;
    if (res && res.state) {
      appState.gameState = res.state;
      appState._lastTabletopPollJson = buildTabletopSnapshotKey(res);
      syncGameUiTransitions(res.state, false);
    }
    renderApp();
    if (keepFocus) {
      const nextInput = document.getElementById("chronicle-chat-input");
      if (nextInput) {
        nextInput.value = "";
        try {
          nextInput.focus({ preventScroll: true });
        } catch (_e) { }
      }
    }
  } catch (err) {
    showToast(err.message || "Could not send chat message.", true);
  } finally {
    appState._chatSendInFlight = false;
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

  const prevChatInput = document.getElementById("chronicle-chat-input");
  const chatWasFocused = Boolean(prevChatInput && document.activeElement === prevChatInput);
  const chatSelStart =
    prevChatInput && typeof prevChatInput.selectionStart === "number" ? prevChatInput.selectionStart : null;
  const chatSelEnd =
    prevChatInput && typeof prevChatInput.selectionEnd === "number" ? prevChatInput.selectionEnd : null;
  if (prevChatInput) {
    appState.chronicleDraftText = prevChatInput.value;
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
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => abbreviateSingleDotRivalNames());
  } else {
    abbreviateSingleDotRivalNames();
  }

  if (typeof window !== "undefined") {
    window.__NM_ACTIVE_GAME_ID__ =
      appState.user &&
      !appState.user.needsUsernameSetup &&
      appState.activeTab === "tabletop" &&
      appState.currentGameId
        ? String(appState.currentGameId)
        : "";
  }

  if (appState.activeTab !== "tabletop") {
    appState.chronicleUserScrolled = false;
    appState.chronicleScrollTop = null;
    appState.spectatorAutoPlay = false;
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
      if (appState.chronicleUserScrolled && typeof appState.chronicleScrollTop === "number") {
        logBoxEl.scrollTop = appState.chronicleScrollTop;
      } else {
        logBoxEl.scrollTop = logBoxEl.scrollHeight;
        appState.chronicleScrollTop = logBoxEl.scrollTop;
      }
    }
    const nextChatInput = document.getElementById("chronicle-chat-input");
    if (nextChatInput) {
      if (typeof appState.chronicleDraftText === "string" && nextChatInput.value !== appState.chronicleDraftText) {
        nextChatInput.value = appState.chronicleDraftText;
      }
      if (chatWasFocused) {
        try {
          nextChatInput.focus({ preventScroll: true });
          if (chatSelStart !== null && chatSelEnd !== null && typeof nextChatInput.setSelectionRange === "function") {
            const maxLen = nextChatInput.value.length;
            nextChatInput.setSelectionRange(Math.min(chatSelStart, maxLen), Math.min(chatSelEnd, maxLen));
          }
        } catch (_focusErr) { }
      }
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
    updateFastCountdownDom();
  }
  syncTutorialUiInDom();
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
          clearResumeGameId();
          appState.user = null;
          appState.csrfToken = null;
          appState.authErrorBanner = null;
          appState.currentGameId = null;
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

async function finalizePortalSignIn(res, successToastMessage) {
  appState.authErrorBanner = null;
  appState.user = res.user;
  appState.csrfToken = res.csrfToken || null;
  applyUserDefaultBoardView(res.user && res.user.settings);
  appState.activeTab = "portal";
  if (res.user && res.user.needsUsernameSetup) {
    showToast("Google account verified! Choose your permanent Collegium username to finish joining.");
    renderApp();
    return;
  }
  await refreshPortalOverview();
  showToast(
    successToastMessage || `Salve, ${res.user.displayName}! Welcome to the Collegium Mercatorum.`
  );
  renderApp();
  await handlePendingInviteDeepLink();
}

function formatGoogleAuthErrorMessage(err) {
  const code = String((err && err.code) || "").toLowerCase();
  const msg = String((err && err.message) || "");
  const lowerMsg = msg.toLowerCase();
  if (
    code.includes("missing-initial-state") ||
    lowerMsg.includes("missing initial state") ||
    lowerMsg.includes("sessionstorage") ||
    lowerMsg.includes("storage-partitioned")
  ) {
    return {
      message:
        "Safari blocked cross-site browser storage required by Firebase's Google Sign-In popup. Please use Email & Password sign-in below, or disable 'Prevent cross-site tracking' in Safari Settings and retry.",
      showBanner: true,
    };
  }
  if (code.includes("popup-blocked")) {
    return {
      message:
        "Your browser blocked the Google Sign-In pop-up window. Allow pop-ups for this site or sign in with Email & Password below.",
      showBanner: true,
    };
  }
  if (code.includes("popup-closed-by-user") || code.includes("cancelled-popup-request")) {
    if (isLikelySafariBrowser()) {
      return {
        message:
          "Google Sign-In pop-up did not complete in Safari. If you saw a storage or pop-up error, use Email & Password below or allow pop-ups / cross-site tracking for this site.",
        showBanner: true,
      };
    }
    return { message: "Google sign-in was cancelled.", showBanner: false };
  }
  if (code.includes("unauthorized-domain")) {
    return {
      message: "This domain is not yet authorized for Firebase Google Sign-In.",
      showBanner: true,
    };
  }
  return { message: msg || "Google sign-in was cancelled or failed.", showBanner: false };
}

async function handleGoogleGisCredentialResponse(response) {
  if (_googleSignInInFlight) return;
  const credential = response && typeof response.credential === "string" ? response.credential.trim() : "";
  if (!credential) {
    showToast("Google sign-in did not return an ID credential.", true);
    return;
  }
  _googleSignInInFlight = true;
  try {
    let res = null;
    if (isFirebaseClientConfigured()) {
      try {
        const fbIdToken = await signInWithFirebaseGoogleCredential(credential);
        if (fbIdToken) {
          res = await apiRequest("/api/auth/firebase", "POST", { idToken: fbIdToken });
        }
      } catch (_fbCredErr) {
        res = null;
      }
    }
    if (!res) {
      res = await apiRequest("/api/auth/google", "POST", { credential });
      if (res && res.firebaseCustomToken && isFirebaseClientConfigured()) {
        try {
          await signInWithFirebaseCustomToken(res.firebaseCustomToken);
        } catch (_tokErr) {}
      }
    }
    await finalizePortalSignIn(
      res,
      `Signed in with Google as ${res.user.displayName} (${maskEmailClient(res.user.email)})!`
    );
  } catch (err) {
    const formatted = formatGoogleAuthErrorMessage(err);
    appState.authErrorBanner = formatted.showBanner ? formatted.message : null;
    showToast(formatted.message, true);
    if (formatted.showBanner) renderApp();
  } finally {
    _googleSignInInFlight = false;
  }
}

function mountGoogleSignInControl(hostEl, fallbackBtnEl, googleClientId) {
  if (!hostEl || !googleClientId) return;
  const runMount = async () => {
    if (!hostEl.isConnected) return;
    const gisId = await loadGoogleIdentityServices();
    if (!gisId || !hostEl.isConnected) return;
    try {
      if (_gisInitializedClientId !== googleClientId) {
        gisId.initialize({
          client_id: googleClientId,
          callback: handleGoogleGisCredentialResponse,
          ux_mode: "popup",
          itp_support: true,
        });
        _gisInitializedClientId = googleClientId;
      }
      const rawWidth = Math.floor(
        hostEl.clientWidth || (hostEl.parentElement && hostEl.parentElement.clientWidth) || 320
      );
      const btnWidth = Math.min(400, Math.max(220, rawWidth));
      hostEl.replaceChildren();
      gisId.renderButton(hostEl, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "signin_with",
        shape: "rectangular",
        logo_alignment: "left",
        width: btnWidth,
      });
      if (fallbackBtnEl && hostEl.childElementCount > 0) {
        fallbackBtnEl.style.display = "none";
      }
    } catch (_gisMountErr) {}
  };
  queueMicrotask(() => {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(runMount);
    } else {
      runMount();
    }
  });
}

async function handleGoogleSignInClick() {
  if (_googleSignInInFlight) return;

  if (isFirebaseClientConfigured()) {
    _googleSignInInFlight = true;
    appState.authErrorBanner = null;
    // Start popup flow synchronously before any await so Safari preserves click activation.
    const idTokenPromise = signInWithFirebaseGooglePopup();
    try {
      const idToken = await idTokenPromise;
      const res = await apiRequest("/api/auth/firebase", "POST", { idToken });
      await finalizePortalSignIn(
        res,
        `Signed in with Google as ${res.user.displayName} (${maskEmailClient(res.user.email)})!`
      );
    } catch (err) {
      const formatted = formatGoogleAuthErrorMessage(err);
      if (formatted.showBanner) {
        appState.authErrorBanner = formatted.message;
        renderApp();
      }
      showToast(formatted.message, true);
    } finally {
      _googleSignInInFlight = false;
    }
    return;
  }

  if (isProductionBackendConfigured()) {
    _googleSignInInFlight = true;
    try {
      await hydrateRuntimeAuthConfig();
      if (getEffectiveGoogleClientId() || isFirebaseClientConfigured()) {
        renderApp();
        showToast("Authentication ready — please click Sign in with Google again.");
      } else {
        showToast("Google Sign-In is unavailable on the server right now. Use Email & Password below.", true);
      }
    } catch (_err) {
      showToast("Could not reach authentication server — please try again in a moment.", true);
    } finally {
      _googleSignInInFlight = false;
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
      closeModal();
      await finalizePortalSignIn(
        res,
        `Signed in with Google as ${res.user.displayName} (${maskEmailClient(res.user.email)})!`
      );
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
    appState.authErrorBanner = null;
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
        let fbToken = null;
        if (res.firebaseCustomToken) {
          try {
            fbToken = await signInWithFirebaseCustomToken(res.firebaseCustomToken);
          } catch (_customTokErr) {
            fbToken = null;
          }
        }
        if (!fbToken && res.user && res.user.email && payload.password) {
          fbToken = await signInWithFirebaseEmailPassword(res.user.email, payload.password);
        }
        if (!fbToken && isProductionBackendConfigured()) {
          throw new Error(
            "Unable to establish your browser authentication session. Please refresh and try again."
          );
        }
      }
      await finalizePortalSignIn(
        res,
        `Salve, ${res.user.displayName}! Welcome to the Collegium Mercatorum.`
      );
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

  const effectiveGoogleClientId = getEffectiveGoogleClientId();
  const fallbackGoogleBtn = el(
    "button",
    {
      type: "button",
      className: "btn-google",
      onClick: handleGoogleSignInClick,
    },
    renderGoogleLogoSvg(),
    el("span", { text: "Sign in with Google" })
  );
  let gisGoogleWrap = null;
  if (effectiveGoogleClientId) {
    const gisHost = el("div", { className: "gis-google-btn-host" });
    gisGoogleWrap = el("div", { className: "gis-google-btn-wrap" }, gisHost);
    mountGoogleSignInControl(gisHost, fallbackGoogleBtn, effectiveGoogleClientId);
  }

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
    appState.authErrorBanner
      ? el("div", {
          className: "auth-safari-notice",
          role: "alert",
          text: appState.authErrorBanner,
        })
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
    gisGoogleWrap,
    fallbackGoogleBtn,
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
    !isFirebaseClientConfigured() && !isProductionBackendConfigured()
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
  if (!Array.isArray(appState.portalBotDifficulties) || appState.portalBotDifficulties.length < 5) {
    appState.portalBotDifficulties = ["ionic", "ionic", "ionic", "ionic", "ionic"];
  }
  if (!appState.portalInviteMode) {
    appState.portalInviteMode = "open";
  }
  if (appState.portalSpeedMode !== "fast") {
    appState.portalSpeedMode = "normal";
  }
  const parsedLimit = Number(appState.portalTurnTimeLimitMinutes);
  if (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 12) {
    appState.portalTurnTimeLimitMinutes = 6;
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
        text: "AI Bot Personas & Difficulty:",
      })
    );
    for (let i = 0; i < count; i++) {
      const currStrat = appState.portalBotStrategies[i] || personas[i % personas.length].strategy;
      appState.portalBotStrategies[i] = currStrat;
      const currDiff = normalizeBotDifficulty(appState.portalBotDifficulties[i]);
      appState.portalBotDifficulties[i] = currDiff;

      const iconWrap = el(
        "span",
        { className: "bot-capital-wrap", title: BOT_DIFFICULTY_META[currDiff].title },
        createColumnCapitalIconNode(currDiff, 18)
      );

      const sel = el(
        "select",
        {
          className: "form-input",
          style: { padding: "0.3rem 0.5rem", fontSize: "0.78rem", flex: "1", minWidth: "0" },
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

      const diffSel = el(
        "select",
        {
          className: "form-input",
          style: { padding: "0.3rem 0.45rem", fontSize: "0.78rem", width: "auto", minWidth: "126px" },
          title: "AI Difficulty Tier",
          onChange: (e) => {
            const nextDiff = normalizeBotDifficulty(e.target.value);
            appState.portalBotDifficulties[i] = nextDiff;
            iconWrap.replaceChildren(createColumnCapitalIconNode(nextDiff, 18));
          },
        },
        ...BOT_DIFFICULTIES.map((dKey) => {
          const meta = BOT_DIFFICULTY_META[dKey];
          return el("option", {
            value: dKey,
            selected: dKey === currDiff,
            text: meta.label,
          });
        })
      );

      rows.push(
        el(
          "div",
          { className: "bot-persona-row" },
          el("span", {
            style: { fontSize: "0.76rem", fontWeight: "700", color: "var(--text-muted)", minWidth: "42px" },
            text: `Bot ${i + 1}:`,
          }),
          sel,
          diffSel,
          iconWrap
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

  const fastLimitSelect = el(
    "select",
    {
      className: "form-input",
      style: { width: "auto", minWidth: "150px", padding: "0.28rem 0.5rem", fontSize: "0.8rem" },
      onChange: (e) => {
        const mins = Math.max(1, Math.min(12, Math.round(Number(e.target.value) || 6)));
        appState.portalTurnTimeLimitMinutes = mins;
      },
    },
    ...Array.from({ length: 12 }, (_v, idx) => idx + 1).map((m) =>
      el("option", {
        value: String(m),
        selected: m === appState.portalTurnTimeLimitMinutes,
        text: `${m} Minute${m === 1 ? "" : "s"} / Turn`,
      })
    )
  );

  const fastLimitContainer = el(
    "div",
    {
      className: "fast-limit-box",
      style: { display: appState.portalSpeedMode === "fast" ? "flex" : "none" },
    },
    el("label", {
      style: { fontSize: "0.76rem", fontWeight: "700", color: "var(--crimson)", margin: "0" },
      text: "⚡ Turn Time Limit (1–12m):",
    }),
    fastLimitSelect,
    el("span", {
      style: { fontSize: "0.7rem", color: "var(--text-muted)" },
      text: "Overdue humans are automatically replaced by Ionic AI bots.",
    })
  );

  const normalSpeedBtn = el(
    "button",
    {
      type: "button",
      className: `speed-mode-card ${appState.portalSpeedMode === "normal" ? "selected" : ""}`,
      onClick: () => {
        appState.portalSpeedMode = "normal";
        normalSpeedBtn.classList.add("selected");
        fastSpeedBtn.classList.remove("selected");
        fastLimitContainer.style.display = "none";
      },
    },
    el("span", { className: "invite-mode-card-title", text: "⏳ Normal Speed" }),
    el("span", {
      className: "invite-mode-card-sub",
      text: "Relaxed untimed turns; Creator/Admin manages player removal.",
    })
  );

  const fastSpeedBtn = el(
    "button",
    {
      type: "button",
      className: `speed-mode-card ${appState.portalSpeedMode === "fast" ? "selected" : ""}`,
      onClick: () => {
        appState.portalSpeedMode = "fast";
        fastSpeedBtn.classList.add("selected");
        normalSpeedBtn.classList.remove("selected");
        fastLimitContainer.style.display = "flex";
      },
    },
    el("span", { className: "invite-mode-card-title", text: "⚡ Fast Speed" }),
    el("span", {
      className: "invite-mode-card-sub",
      text: "Timed turns (1–12m); AFK humans convert to Ionic AI.",
    })
  );

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
      const speedMode = appState.portalSpeedMode === "fast" ? "fast" : "normal";
      const turnLimit =
        speedMode === "fast"
          ? Math.max(1, Math.min(12, Math.round(Number(fastLimitSelect.value || appState.portalTurnTimeLimitMinutes) || 6)))
          : null;
      const res = await apiRequest("/api/games/create", "POST", {
        name: nameInput.value.trim(),
        maxPlayers: Number(maxPlayersSelect.value),
        botCount: bCount,
        botStrategies: appState.portalBotStrategies.slice(0, bCount),
        botDifficulties: appState.portalBotDifficulties.slice(0, bCount).map(normalizeBotDifficulty),
        speedMode,
        turnTimeLimitMinutes: turnLimit,
        startImmediately,
        inviteMode: modeToSend,
        invitedUsernames: modeToSend === "invite_only" ? invitedUsernamesInput.value.trim() : "",
      });
      await refreshPortalOverview();
      if (startImmediately && res.state) {
        appState.currentGameId = res.summary.id;
        appState.gameSummary = res.summary;
        appState.gameState = res.state;
        appState._lastTabletopPollJson = buildTabletopSnapshotKey(res);
        stopNpcTurnPacing();
        enqueueNewNpcEvents(res.state, true);
        seedSeenScoutIds(res.state);
        syncGameUiTransitions(res.state, true);
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
      el("label", { text: "Game Speed & Turn Clock" }),
      el("div", { className: "speed-mode-grid" }, normalSpeedBtn, fastSpeedBtn),
      fastLimitContainer
    ),
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
                    difficulty: normalizeBotDifficulty(s.botDifficulty),
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
        : el(
          "span",
          {},
          createPlayerNameNode({ name: s.name, isBot: s.isBot, botDifficulty: s.botDifficulty }, { iconSize: 17 })
        ),
      isLobby && isHost && s.isBot
        ? el(
          "select",
          {
            className: "form-input",
            style: { padding: "0.1rem 0.32rem", fontSize: "0.72rem", width: "auto" },
            title: "Change AI Difficulty",
            onChange: async (e) => {
              try {
                await apiRequest(`/api/games/${g.id}/update-bot`, "POST", {
                  seatIndex: s.seatIndex,
                  strategy: s.botStrategy,
                  difficulty: e.target.value,
                });
                await refreshPortalOverview();
                renderApp();
              } catch (err) {
                showToast(err.message, true);
              }
            },
          },
          ...BOT_DIFFICULTIES.map((dKey) =>
            el("option", {
              value: dKey,
              selected: dKey === normalizeBotDifficulty(s.botDifficulty),
              text: BOT_DIFFICULTY_META[dKey].shortLabel,
            })
          )
        )
        : null,
      isLobby && isHost && s.isBot
        ? createColumnCapitalIconNode(s.botDifficulty, 17)
        : null,
      isLobby && isHost && s.seatIndex >= 0
        ? el("button", {
            className: "btn btn-sm",
            style: { padding: "0.05rem 0.35rem", marginLeft: "0.2rem" },
          title:
            s.userId === appState.user.id
              ? "Step down from this seat to spectate as Host"
              : "Remove seat from lobby",
            text: "✕",
            onClick: async () => {
              try {
                const steppingDown = s.userId === appState.user.id;
                await apiRequest(`/api/games/${g.id}/remove-seat`, "POST", { seatIndex: s.seatIndex });
                await refreshPortalOverview();
                if (steppingDown) {
                  showToast("Stepped down from your seat — you remain Host & can spectate.");
                }
                renderApp();
              } catch (err) {
                showToast(err.message, true);
              }
            },
          })
        : null
    )
  );

  if (isLobby && isHost && !isSeated) {
    seatNodes.push(
      el("span", {
        className: "seat-pill spectator-pill",
        title: "You are Host without a player seat and will enter in Spectator Mode when the match starts",
        text: "👁️ Host (Spectating)",
      })
    );
  }

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
      const addBotDiffSelect = el(
        "select",
        {
          className: "form-input",
          style: { padding: "0.2rem 0.4rem", fontSize: "0.75rem", width: "auto" },
          title: "Select AI Difficulty to Add",
        },
        ...BOT_DIFFICULTIES.map((dKey) =>
          el("option", {
            value: dKey,
            selected: dKey === "ionic",
            text: BOT_DIFFICULTY_META[dKey].label,
          })
        )
      );
      actionBtns.push(
        addBotStratSelect,
        addBotDiffSelect,
        el("button", {
          className: "btn btn-sm",
          text: "+ Add AI Bot",
          onClick: async () => {
            try {
              await apiRequest(`/api/games/${g.id}/add-bot`, "POST", {
                strategy: addBotStratSelect.value,
                difficulty: addBotDiffSelect.value,
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
              appState._lastTabletopPollJson = buildTabletopSnapshotKey(res);
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
        text:
          g.status === "finished"
            ? "View Final Scoreboard"
            : isSeated
              ? "Enter Tabletop ⚔️"
              : "👁️ Spectate Match",
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

  const speedBadge =
    g.speedMode === "fast"
      ? el("span", {
        className: "speed-badge fast",
        title: `Fast Speed: ${g.turnTimeLimitMinutes || 6} minute turn limit`,
        text: `⚡ Fast (${g.turnTimeLimitMinutes || 6}m)`,
      })
      : el("span", {
        className: "speed-badge normal",
        title: "Normal Speed: Untimed turns",
        text: "⏳ Normal",
      });

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
        accessBadge,
        speedBadge
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

function renderSpectatorControlsBanner(gs) {
  const viewer = getViewerPlayer(gs);
  const players = Array.isArray(gs.players) ? gs.players : [];
  const zeroHumans = players.length > 0 && players.every((p) => p.isBot);
  if (viewer && !zeroHumans) return null;

  const g = appState.gameSummary;
  const isHostOrAdmin = Boolean(
    g && appState.user && (g.hostUserId === appState.user.id || appState.user.isAdmin)
  );
  const finished = gs.phase === "finished";

  let statusText = "Observing live match with public visibility (hidden opponent hands remain concealed).";
  if (finished) {
    statusText = "Match concluded — Final Scoreboard & public Chronicle available.";
  } else if (zeroHumans) {
    statusText = appState.spectatorAutoPlay
      ? "All-AI Match — Auto-Play active, stepping AI bot turns automatically."
      : "All-AI Match — Manual AI pacing enabled (use Step Next AI Turn or Auto-Play AI).";
  }

  const controls = [];
  if (!finished && zeroHumans) {
    if (isHostOrAdmin) {
      controls.push(
        el("button", {
          type: "button",
          className: "btn btn-sm btn-primary",
          disabled: appState._spectatorStepInFlight || appState.spectatorAutoPlay,
          title: "Advance one AI turn / phase action cleanly",
          text: appState._spectatorStepInFlight ? "⏳ Stepping..." : "⏭️ Step Next AI Turn",
          onClick: () => triggerSpectatorStep({ silentToast: false }),
        }),
        el("button", {
          type: "button",
          className: `btn btn-sm ${appState.spectatorAutoPlay ? "btn-crimson" : ""}`,
          title: "Toggle continuous automatic AI stepping",
          text: appState.spectatorAutoPlay ? "⏸️ Pause Auto-Play" : "▶️ Auto-Play AI",
          onClick: () => {
            if (appState.spectatorAutoPlay) {
              appState.spectatorAutoPlay = false;
              if (appState._spectatorAutoTimer) {
                clearTimeout(appState._spectatorAutoTimer);
                appState._spectatorAutoTimer = null;
              }
              renderApp();
            } else {
              appState.spectatorAutoPlay = true;
              renderApp();
              triggerSpectatorStep({ silentToast: true });
            }
          },
        })
      );
    } else {
      controls.push(
        el("span", {
          style: { fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic" },
          text: "Host or Admin controls AI stepping.",
        })
      );
    }
  }

  return el(
    "div",
    { className: "spectator-banner" },
    el(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" } },
      el("span", { className: "badge spectator-pill", text: "👁️ Spectator Mode" }),
      el("span", { style: { fontSize: "0.82rem", fontWeight: "600" }, text: statusText })
    ),
    controls.length > 0
      ? el("div", { style: { display: "flex", gap: "0.45rem", flexWrap: "wrap", alignItems: "center" } }, ...controls)
      : null
  );
}

function renderTabletopView() {
  const gs = appState.gameState;
  if (!gs) {
    return el("div", { className: "portal-container" }, el("p", { text: "Loading game state..." }));
  }

  const viewer = getViewerPlayer(gs);
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
          : gs.phase === "market" || gs.phase === "setup_discard"
          ? "market"
          : "rome";
    }
  }

  const mainBoards = [];
  if (gs.phase === "setup_discard") {
    if (viewer && !viewer.setupDiscarded) {
      mainBoards.push(renderSetupDiscardPanel(viewer));
    } else {
      const pendingPlayers = (gs.players || []).filter((p) => !p.setupDiscarded).map((p) => p.name);
      mainBoards.push(
        el(
          "div",
          { className: "panel", style: { borderColor: "var(--gold-bright)" } },
          el("h3", {
            className: "panel-title",
            text: viewer
              ? "⏳ Starting Hand Confirmed — Awaiting Rival Merchants"
              : "👁️ Preparation — Merchants Selecting Starting Contracts",
          }),
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
  if (viewer && (viewer.pendingCartOverflow || []).length > 0) {
    mainBoards.push(renderPendingCartOverflowPanel(gs, viewer));
  }
  if (viewer && (viewer.pendingMarketReward || []).length > 0) {
    mainBoards.push(renderPendingMarketRewardPanel(gs, viewer));
  }
  if (viewer && viewer.pendingNpcOffer) {
    mainBoards.push(renderPendingNpcOfferPanel(gs, viewer));
  }
  if (viewer && hasMissionOverflow(viewer, gs)) {
    mainBoards.push(renderPendingMissionOverflowPanel(gs, viewer));
  }
  if (viewer && gs.phase === "cleanup" && !viewer.cleanupDone) {
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
    renderSpectatorControlsBanner(gs),
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
    setup_discard: "Prep: Discard",
    setup_climate: "Prep: Climate",
    market: "Phase I: Market",
    delivery_entry: "Phase II: Entry Selection",
    delivery: "Phase II: Delivery",
    cleanup: "Phase III: Dawn",
    finished: "Game Complete",
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

  const speedBadge =
    gs.speedMode === "fast"
      ? el("span", {
          className: "speed-badge fast",
          title: `Fast Speed: Overdue humans swap to Ionic AI after ${gs.turnTimeLimitMinutes || 6} minute(s)`,
          text: `Fast (${gs.turnTimeLimitMinutes || 6}m)`,
        })
      : null;

  const remSec = getFastCountdownRemainingSec(gs);
  const countdownBadge =
    remSec !== null
      ? el(
          "span",
          {
            className: "badge fast-countdown-badge",
            title: "Time remaining before overdue human turn swaps to Ionic AI",
          },
          el("span", {
            id: "fast-countdown-timer",
            className: remSec <= 30 ? "urgent" : "",
            text: formatCountdownSeconds(remSec),
          })
        )
      : null;

  const firstShort = getAbbrevMerchantName(firstPlayer);
  const activeShort = getAbbrevMerchantName(activePlayer);

  return el(
    "div",
    { className: "clock-banner" },
    el(
      "div",
      { className: "clock-badges" },
      el("span", {
        className: "badge badge-season",
        title: `Season: ${gs.season} 211 A.D.`,
        text: String(gs.season || "Spring"),
      }),
      el("span", { className: "badge badge-phase", text: phaseNames[gs.phase] || gs.phase }),
      gs.phase === "delivery" ? el("span", { className: "badge badge-hour", text: String(gs.turnHourLabel || "") }) : null,
      el("span", {
        className: "badge",
        title: `1st Player: ${(firstPlayer && firstPlayer.name) || "Merchant"}`,
        text: `1st: ${firstShort}`,
      }),
      el("span", {
        className: "badge",
        style: { borderColor: "#16a34a", color: "#14532d", background: "#ecfdf5" },
        title: `Active Turn: ${(activePlayer && activePlayer.name) || "Merchant"}`,
        text: `Active: ${activeShort}`,
      }),
      speedBadge,
      countdownBadge,
      !viewer ? el("span", { className: "badge spectator-pill", text: "Spectating" }) : null
    ),
    el(
      "div",
      { className: "clock-banner-actions" },
      viewer
        ? el("button", {
            className: "btn btn-sm",
            style: canUndo ? { borderColor: "#8c5612", color: "#6e2119" } : {},
            disabled: !canUndo || undoPending,
            title: undoTooltip,
            text: undoPending ? "Undo Pending..." : "Undo Turn",
            onClick: () => sendGameAction({ type: "request_undo_turn" }),
          })
        : null,
      ...["auto", "rome", "market", "climate", "both"].map((mode) =>
        el("button", {
          className: `btn btn-sm ${appState.boardViewMode === mode ? "btn-primary" : ""}`,
          title:
            mode === "climate"
              ? `Switch to the 6×3 Roman Senate Political Climate Board (${activeClimateCount} enacted)`
              : mode === "both"
              ? "Show all boards together"
              : undefined,
          text:
            mode === "auto"
              ? "Auto"
              : mode === "rome"
              ? "Rome"
              : mode === "market"
              ? "Market"
              : mode === "climate"
              ? "Decrees"
              : "All",
          onClick: () => {
            appState.boardViewMode = mode;
            renderApp();
          },
        })
      ),
      el("button", {
        type: "button",
        className: "btn btn-sm",
        title: "Inspect all 6 decks (Patricii, Legiones, Nefarii, Goods & Guards, Missiones, Influence), Goods counts, or Scout",
        text: "Decks",
        onClick: () => openEncounterDecksOverviewModal(gs),
      })
    )
  );
}

function renderContextualPromptBanner(gs, viewer, activePlayer) {
  let promptText = "";
  const extraActions = [];

  if (gs.phase === "setup_discard") {
    promptText = viewer
      ? "Setup: Discard 2 Starting Missions and 2 Influence cards below. First to confirm drafts Political Climate first and acts last in turn order."
      : "Setup (Spectating): Seated merchants are discarding 2 Starting Missions and 2 Influence cards.";
  } else if (gs.phase === "setup_climate") {
    const pc = gs.politicalClimate || {};
    const stepNum = Math.min((Number(pc.draftStep) || 0) + 1, Math.max(1, (pc.draftOrder || []).length));
    const totalPicks = (pc.draftOrder || []).length || gs.players.length;
    promptText = `Political Climate Draft — Pick ${stepNum} of ${totalPicks} (${activePlayer.name}): ${viewer ? "Click a decree in an open column below to enact it." : "Spectating Senate decree selection."
      }`;
  } else if (gs.phase === "market") {
    promptText = `Ostia Market — ${activePlayer.name}'s turn: Buy 1 Good or Guard, Source a Good, or Pass (${gs.marketConsecutivePasses}/${gs.players.length} passed).`;
    if (viewer && gs.activePlayerIndex === viewer.index) {
      extraActions.push(
        el("button", {
          className: "btn btn-sm",
          text: "📦 Source Good (Discard 1 Influence)",
          disabled: viewer.influence.length === 0,
          onClick: () => openMarketSourceModal(gs, viewer),
        }),
        el("button", {
          id: "btn-market-pass",
          className: "btn btn-sm btn-crimson",
          text: "Pass Market Turn ⏭️",
          onClick: () => sendGameAction({ type: "market_pass" }),
        })
      );
    }
  } else if (gs.phase === "delivery_entry") {
    promptText = viewer
      ? "⛩️ Start of Night Delivery (8:00 P.M.): You must start at one of the six Via entrances highlighted in gold on the map (A4, B1, B6, E1, F3, or F6). You may optionally Scout 1 neighborhood stack or deck card first."
      : `⛩️ Start of Night Delivery (8:00 P.M.): ${activePlayer.name} is selecting a Via gate entrance into Rome.`;
    if (viewer && gs.activePlayerIndex === viewer.index) {
      extraActions.push(
        el("button", {
          id: "btn-entry-scout",
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
    if (!viewer) {
      promptText = `Night Delivery (${gs.turnHourLabel}): ${activePlayer.name}'s turn (${activePlayer.movesRemaining ?? 0} moves left at ${activePlayer.position || "Gate"
        }). Exit before Turn 10 ends (${fineBase}d Curfew Fine; ${fineGate}d on a Gate).`;
    } else {
      const isMyDeliveryActive = gs.activePlayerIndex === viewer.index;
      const hasTxAvailableNow = isMyDeliveryActive && hasAvailableDeliveryTransactionNow(gs, viewer);
      const txStatusText =
        viewer.transactedThisTurn || viewer.gambledThisTurn
          ? "Transacted ✓"
          : isMyDeliveryActive
            ? hasTxAvailableNow
              ? "1 Transaction available"
              : "No transaction available here"
            : `Waiting on ${activePlayer ? activePlayer.name : "active merchant"}`;
      if (gs.turn === 1 && viewer.movesRemaining === 0) {
        promptText = `Turn 1 (8:00 P.M.) at ${viewer.position || "Gate"}: ${txStatusText} • Scout (anytime) or End Turn.`;
      } else {
        promptText = `Night Delivery (${gs.turnHourLabel}): ${viewer.movesRemaining} move left • ${txStatusText}. Exit before Turn 10 ends (${fineBase}d Curfew Fine; ${fineGate}d on a Gate).`;
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
        const canActInRome = hasViewerEnteredRomeForDelivery(gs, viewer);
        if (canActInRome && currCell && currCell.isForum && currRev && Array.isArray(currRev.buys) && currRev.buys.length > 0) {
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
        if (canActInRome && currRev && currRev.gamble) {
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
        const promptBlocked = Boolean(gs.pendingEncounter) || hasPlayerBlockingPrompt(viewer, true, gs);
        const overflowActive = hasMissionOverflow(viewer, gs);
        extraActions.push(
          el("button", {
            id: "btn-delivery-scout",
            type: "button",
            className: "btn btn-sm",
            title: "Free once-per-turn Scout: peek at the top unrevealed tile of any stack or top card of any of the 6 decks (usable before or after Moving/Transacting without ending your turn)",
            text: "👁️ Scout",
            disabled: viewer.scoutedThisTurn || promptBlocked,
            onClick: () => openScoutModal(gs, viewer),
          }),
          el("button", {
            type: "button",
            className: "btn btn-sm",
            title: "Discard 1 Influence card (once per turn, before or after moving) to trash an exposed face-up tile, top unrevealed stack tile, or top card of any of the 6 decks",
            text: "🗑️ Trash Tile/Card",
            disabled: viewer.trashedThisTurn || viewer.influence.length === 0 || promptBlocked,
            onClick: () => openTrashModal(gs, viewer),
          }),
          el("button", {
            id: "btn-delivery-end-turn",
            type: "button",
            className: "btn btn-sm btn-crimson",
            title: overflowActive
              ? "Cannot end turn with more than 5 active missions — cancel 1 mission first"
              : promptBlocked
              ? "Resolve your active prompt before ending your turn"
              : "End your hourly turn",
            text: "End Turn ⏭️",
            disabled: promptBlocked,
            onClick: () => sendGameAction({ type: "delivery_end_turn" }),
          })
        );
      }
      if (hasMissionOverflow(viewer, gs)) {
        extraActions.push(
          el("button", {
            type: "button",
            className: "btn btn-sm btn-primary",
            text: `⚠️ ${(viewer.missions || []).length}/5 Missions — Cancel 1`,
            onClick: () => openPendingMissionOverflowModal(gs, viewer),
          })
        );
      }
    }
  } else if (gs.phase === "cleanup") {
    promptText = viewer
      ? `Dawn Clean-Up (${gs.season}): Buy Influence (${viewer.influenceBuyCost}d), manage Loans, and pay Guard upkeep.`
      : `Dawn Clean-Up (${gs.season}): Merchants are resolving Influence purchases, Loans, and Guard upkeep.`;
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

function openPoliticalClimateHelpModal(gs) {
  showModal(
    "🏛️ How the Political Climate Board Works",
    el(
      "div",
      {},
      buildPoliticalClimateExplainerNode(gs),
      el(
        "div",
        { style: { display: "flex", justifyContent: "flex-end", marginTop: "0.8rem" } },
        el("button", {
          type: "button",
          className: "btn btn-primary",
          text: "Close",
          onClick: closeModal,
        })
      )
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

function pickRandomClimateOption(gs) {
  const pc = (gs && gs.politicalClimate) || {};
  const options =
    Array.isArray(pc.options) && pc.options.length > 0 ? pc.options : DEFAULT_POLITICAL_CLIMATE_OPTIONS;
  const activeByFactor = pc.activeByFactor || {};
  const eligible = options.filter((opt) => opt && opt.id && opt.factor && !activeByFactor[opt.factor]);
  if (eligible.length === 0) return null;
  const chosen = eligible[Math.floor(Math.random() * eligible.length)];
  if (!chosen) return null;
  sendGameAction({ type: "select_climate_option", optionId: chosen.id });
  return chosen;
}

function renderPoliticalClimateBoard(gs, viewer) {
  const pc = (gs && gs.politicalClimate) || {};
  const isDraftPhase = gs.phase === "setup_climate";
  const activeCount = Array.isArray(pc.activeIds) ? pc.activeIds.length : 0;
  const draftOrder = Array.isArray(pc.draftOrder) ? pc.draftOrder : [];
  const draftStep = Number(pc.draftStep) || 0;
  const isMyPick = isDraftPhase && Boolean(viewer) && gs.activePlayerIndex === viewer.index;
  const waitingPlayer = (gs.players && gs.players[gs.activePlayerIndex]) || { name: "Merchant" };

  return el(
    "div",
    { className: "senate-climate-board", id: "political-climate-board" },
    el(
      "div",
      { className: "panel-title fresco-banner-header fresco-griffin", style: { flexWrap: "wrap", gap: "0.5rem" } },
      el(
        "div",
        { className: "climate-title-with-help" },
        el("span", { text: "🏛️ Curia Julia — Political Climate Board" }),
        el("button", {
          type: "button",
          id: "btn-political-climate-help",
          className: "climate-help-circle-btn",
          title: "How the Political Climate Board Works",
          "aria-label": "How the Political Climate Board Works",
          text: "?",
          onClick: () => openPoliticalClimateHelpModal(gs),
        })
      ),
      el(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" } },
        isDraftPhase
          ? isMyPick
            ? el("span", {
              className: "badge",
              style: {
                borderColor: "#16a34a",
                color: "#14532d",
                background: "#ecfdf5",
                fontWeight: "800",
                textShadow: "none",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.28)",
              },
              text: "▶ Your Pick",
            })
            : el(
              "span",
              {
                className: "badge",
                style: { borderColor: "#d97706", color: "#78350f", background: "#fffbeb", textShadow: "none" },
              },
              "Waiting on ",
              createPlayerNameNode(waitingPlayer, { iconSize: 16 })
            )
          : el("span", {
              className: "badge",
            style: { borderColor: "#deb86c", color: "#fde6b0", background: "rgba(32, 14, 8, 0.72)", textShadow: "none" },
              text: `${activeCount} Enacted`,
            }),
        isMyPick
          ? el("button", {
            type: "button",
            id: "btn-random-decree",
            className: "btn btn-sm btn-primary",
            title: "Randomly select and enact one open Decree on the Political Climate Board",
            text: "🎲 Pick Random Decree",
            onClick: () => pickRandomClimateOption(gs),
          })
          : null,
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
              el("strong", {}, `#${idx + 1} `, createPlayerNameNode(pl, { iconSize: 16 })),
              pickInfo ? el("span", { text: ` • ${pickInfo.factor}` }) : null
            );
          })
        )
      : null,
    buildPoliticalClimateBoardGridNode(gs, viewer, isDraftPhase)
  );
}

function renderSetupDiscardPanel(viewer) {
  const mDisc = appState.setupDiscardMissions;
  const iDisc = appState.setupDiscardInfluence;

  return el(
    "div",
    { id: "setup-discard-panel", className: "panel", style: { borderColor: "var(--gold-bright)" } },
    el(
      "h3",
      { className: "panel-title" },
      el("span", { text: "📜 Initial Setup: Discard 2 Missions & 2 Influence Cards" }),
      el(
        "div",
        { style: { display: "flex", gap: "0.4rem", flexWrap: "wrap" } },
        el("button", {
          type: "button",
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
      )
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

/**
 * Collect all dice eligible for Twist Of Fate re-rolling in the current pending stage.
 */
function getEligibleRerollTargets(pend) {
  if (!pend) return [];
  const stage = pend.stage || "pre_decision";
  const targets = [];
  if (stage === "combat_pre_strike_post_roll") {
    const pDice = Array.isArray(pend.playerDiceObjs) ? pend.playerDiceObjs : [];
    pDice.forEach((_, idx) => {
      targets.push({ targetSide: "player", dieIndex: idx, targetIndex: idx });
    });
  } else if (stage === "combat_post_roll") {
    const pDice = Array.isArray(pend.playerDiceObjs) ? pend.playerDiceObjs : [];
    pDice.forEach((_, idx) => {
      targets.push({ targetSide: "player", dieIndex: idx, targetIndex: idx });
    });
    const oDice = Array.isArray(pend.oppDiceObjs) ? pend.oppDiceObjs : [];
    oDice.forEach((_, idx) => {
      targets.push({ targetSide: "opponent", dieIndex: idx, targetIndex: idx });
    });
  } else if (stage === "driver_fate_post_roll" || stage === "chart_post_roll" || stage === "demand_post_roll") {
    targets.push({ targetSide: "player", dieIndex: 0, targetIndex: 0 });
  } else if (stage === "gamble_post_roll") {
    const gRolls = Array.isArray(pend.gambleRolls) ? pend.gambleRolls : [];
    gRolls.forEach((_, idx) => {
      targets.push({ targetSide: "player", dieIndex: idx, targetIndex: idx });
    });
  }
  return targets;
}

/**
 * Auto-dispatch Twist Of Fate immediately when only 1 eligible die exists; otherwise arm die selection.
 */
function triggerTwistOfFateOrArm(gs, cardObj) {
  if (!cardObj || !cardObj.id) return;
  const pend = gs && gs.pendingEncounter ? gs.pendingEncounter : null;
  const targets = getEligibleRerollTargets(pend);
  if (targets.length === 1) {
    const t = targets[0];
    appState.armedDieAction = null;
    sendGameAction({
      type: "play_influence",
      cardId: cardObj.id,
      targetSide: t.targetSide,
      dieIndex: t.dieIndex,
      targetIndex: t.targetIndex,
    });
    return;
  }
  armDieCardAction(cardObj, "reroll");
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
  if (stage === "combat_pre_strike_post_roll") {
    const pDice = Array.isArray(pend.playerDiceObjs) ? pend.playerDiceObjs : [];
    pDice.forEach((d, idx) => {
      const rom = d.roman !== undefined ? String(d.roman) : toRomanDieSymbol(Number(d.value) || 0);
      const isBlock = d.sign === 0;
      const signNote = isBlock ? `🛡️ Block (${rom} Wnd)` : `${rom} Strike Wnd`;
      dieButtons.push(
        el(
          "button",
          {
            type: "button",
            className: `inline-roman-die-btn ${hasTwist ? "clickable-die" : ""} ${hasTwist && isArmed ? "armed-die" : ""}`,
            disabled: !hasTwist,
            title: hasTwist ? `Click this die to re-roll with 'Twist Of Fate'` : d.label || "Pre-Strike Die",
            onClick: hasTwist ? () => handleDieSelectionClick(pend, viewer, "player", idx) : null,
          },
          el("span", { className: "inline-roman-die-face", text: rom }),
          el(
            "span",
            { className: "inline-roman-die-meta" },
            el("span", { className: "inline-roman-die-owner", text: d.label || `Pre-Strike Die #${idx + 1}` }),
            el("span", {
              className: "inline-roman-die-action",
              text: hasTwist ? `${signNote} • ${actionHint}` : signNote,
            })
          )
        )
      );
    });
  } else if (stage === "combat_post_roll") {
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
    const oppDieOwnerLabel = pend.isPvp && pend.card && pend.card.name ? pend.card.name : "Opponent";
    oDice.forEach((d, idx) => {
      const rom = d.roman !== undefined ? String(d.roman) : toRomanDieSymbol(Number(d.value) || 0);
      dieButtons.push(
        el(
          "button",
          {
            type: "button",
            className: `inline-roman-die-btn ${hasTwist ? "clickable-die" : ""} ${hasTwist && isArmed ? "armed-die" : ""}`,
            disabled: !hasTwist,
            title: hasTwist ? `Click this ${oppDieOwnerLabel} die to re-roll with 'Twist Of Fate'` : `${oppDieOwnerLabel} ${d.label || "Die"}`,
            onClick: hasTwist ? () => handleDieSelectionClick(pend, viewer, "opponent", idx) : null,
          },
          el("span", { className: "inline-roman-die-face", text: rom }),
          el(
            "span",
            { className: "inline-roman-die-meta" },
            el("span", { className: "inline-roman-die-owner", text: `${oppDieOwnerLabel} • ${d.label || `Die #${idx + 1}`}` }),
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
    if (c.preRollStrike) {
      effParts.push(`Pre-Roll Strike ${c.dice || 1}(R)`);
    } else {
      if (c.dice) effParts.push(`+${c.dice}(R)`);
      if (c.flat) effParts.push(`${formatSignedFlat(c.flat)} CP`);
    }
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
          text: `${c.preRollStrike ? "🏹" : "🗡️"} ${it.name || it.item || "Weapon"} (${effLabel} — Destroyed if Used)`,
        }),
        el("div", {
          style: { fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.18rem" },
          text: isChecked
            ? c.preRollStrike
              ? `Selected for pre-roll strike: Fires ${c.dice || 1}(R) Wounds BEFORE main combat dice roll, then is destroyed and removed from your Cart.`
              : `Selected for this combat: Grants ${effLabel}, then is destroyed and removed from your Cart.`
            : c.preRollStrike
            ? "Kept safe on your Cart: Fires 0 pre-roll Wounds and is NOT destroyed."
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
  const viewerCurr = getViewerPlayer(gsCurr);
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
  const encPlayer =
    (gs.players && gs.players[pend.playerIndex]) || viewer || (gs.players && gs.players[0]) || { name: "Merchant", color: "Z3" };
  const isOtherPlayerEncounter = !viewer || pend.playerIndex !== viewer.index;
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
            pend.deck && ENCOUNTER_DECK_PROFILES[String(pend.deck).toLowerCase()]
              ? el("button", {
                  type: "button",
                  className: "btn btn-sm",
                  style: { padding: "0.14rem 0.5rem", fontSize: "0.75rem" },
                  title: "Inspect Encounter Deck mechanics, Roman history, and live faction card counts",
                  text: "🃏 Deck Guide",
                  onClick: () => openEncounterDecksOverviewModal(gs, pend.deck),
                })
              : null,
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
        ? "/assets/icons/encounters/mob_center.png"
        : cType === "theater"
          ? "/assets/icons/encounters/theater_center.png"
          : "/assets/icons/encounters/soothsayer_center.png";
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
            { roll: "0", color: "#991b1b", bg: "#fef2f2", border: "#dc2626", title: "Roll 0 — Mocked on Stage:", desc: "Lose all Friendly Favor outcomes." },
            { roll: "I", color: "#15803d", bg: "#f0fdf4", border: "#16a34a", title: "Roll I — Satire Clears Your Name:", desc: "Lose all Hostile Favor outcomes!" },
            { roll: "II", color: "#713f12", bg: "#fefce8", border: "#ca8a04", title: "Roll II — Blocked by Revelers:", desc: "Lose the rest of this turn AND skip your next turn." },
            { roll: "III", color: "#14532d", bg: "#ecfdf5", border: "#15803d", title: "Roll III — Inspired Patron:", desc: "Roll 1(R) and draw that many Influence cards!" },
          ]
        : [
            { roll: "0", color: "#991b1b", bg: "#fef2f2", border: "#dc2626", title: "Roll 0 — Bare Prophecy:", desc: "Accept the mandatory Mission (0 bonus Influence sealed)." },
            { roll: "I–II", color: "#92400e", bg: "#fffbeb", border: "#d97706", title: "Roll I or II — Fated Omen:", desc: "Accept the mandatory Mission + seal 1 or 2 Influence cards unlocked on completion." },
            { roll: "III", color: "#15803d", bg: "#f0fdf4", border: "#16a34a", title: "Roll III — Auspicious Vision:", desc: "Accept the mandatory Mission + seal 3 Influence cards unlocked on completion!" },
          ];

    const preChartCards = viewer && !isOtherPlayerEncounter
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
    const isPvp = Boolean(pend.isPvp);
    const consumableActorIdx =
      pend.consumableRole === "defender" && pend.pvpDefenderIndex != null
        ? pend.pvpDefenderIndex
        : pend.interveningPlayerIndex != null
        ? pend.interveningPlayerIndex
        : pend.playerIndex;
    const consumableActor =
      (gs.players &&
        (gs.players.find((p) => p.index === consumableActorIdx) || gs.players[consumableActorIdx])) ||
      encPlayer;
    const isOtherConsumableActor = !viewer || !consumableActor || viewer.index !== consumableActor.index;
    const consumables = Array.isArray(pend.consumableItems)
      ? pend.consumableItems
      : (consumableActor.cart || []).filter((it) => it && it.combat && it.combat.consumable);
    const consumableKey = `${card.id || "combat"}_${pend.consumableRole || "npc"}`;
    if (!appState._stageConsumableSelection || appState._stageConsumableEncounterCardId !== consumableKey) {
      appState._stageConsumableEncounterCardId = consumableKey;
      appState._stageConsumableSelection = new Set();
    }
    const selectedSet = appState._stageConsumableSelection;

    const pvpSummaryCardNode = el(
      "div",
      {
        style: {
          padding: "0.9rem",
          borderRadius: "6px",
          border: "2px solid #991b1b",
          background: "linear-gradient(180deg, #fffdf7 0%, #f5ebd4 100%)",
          boxShadow: "var(--bevel-sunken)",
        },
      },
      el("div", {
        style: { fontFamily: '"Cinzel", serif', fontWeight: "900", color: "#7f1d1d", fontSize: "0.95rem", marginBottom: "0.35rem" },
        text: "⚔️ Casus Belli PvP Combat",
      }),
      el("div", {
        style: { fontSize: "0.84rem", fontWeight: "700", color: "var(--text-main)", marginBottom: "0.3rem" },
        text: `${encPlayer.name} (Attacker) vs. ${card.name || "Opponent"} (Defender)`,
      }),
      pend.encounterSource
        ? el("div", {
            style: { fontSize: "0.78rem", color: "#92400e", fontWeight: "700", marginBottom: "0.25rem" },
            text: `📍 ${pend.encounterSource}`,
          })
        : null,
      el("div", {
        style: { fontSize: "0.78rem", color: "var(--text-muted)" },
        text: `${consumableActor.name} is selecting whether to expend consumable weapon(s) (${
          pend.consumableRole === "defender" ? "Defending" : "Attacking"
        }) before combat dice are rolled.`,
      })
    );

    const preRollCombatCards =
      !isOtherConsumableActor && viewer
        ? (viewer.influence || []).filter(
            (c) => c.name === "Mercenary Ambush" || c.name === "Distraction"
          )
        : [];

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
        el("span", {
          text: isPvp
            ? `🗡️ Pre-Combat Weapon Choice (${consumableActor.name}) — ${encPlayer.name} vs. ${card.name || "Opponent"}`
            : `🗡️ Pre-Combat Weapon Choice vs. ${card.name || "Opponent"}`,
        }),
        el("span", {
          style: { fontSize: "0.78rem", color: "var(--gold-bright)" },
          text: "Decide whether to expend destroyed-if-used weapon(s) before rolling!",
        })
      ),
      el(
        "div",
        { className: "encounter-interactive-layout" },
        isPvp ? pvpSummaryCardNode : card && card.id ? renderPhysicalEncounterCardNode(card, pend, { interactive: false }) : null,
        el(
          "div",
          {},
          el("p", {
            style: { marginTop: "0", fontSize: "0.88rem", color: "#78350f", fontWeight: "700" },
            text: `Choose which consumable ('destroyed if used') weapon(s) on ${
              isOtherConsumableActor ? `${consumableActor.name}'s` : "your"
            } Cart to use in this combat before rolling the combat dice:`,
          }),
          el(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "0.55rem", marginBottom: "0.9rem" } },
            ...buildConsumableWeaponPickerNodes(consumables, selectedSet, () => renderApp())
          ),
          preRollCombatCards.length > 0
            ? el(
                "div",
                { style: { marginBottom: "0.9rem" } },
                el("div", {
                  style: { fontSize: "0.8rem", fontWeight: "700", color: "var(--gold-bright)", marginBottom: "0.4rem" },
                  text: "🃏 Pre-Roll Combat Influence Cards (Play Before Rolling):",
                }),
                el(
                  "div",
                  { className: "phys-cards-grid compact-sidebar-grid" },
                  ...preRollCombatCards.map((rc) =>
                    renderPhysicalInfluenceCardNode(rc, {
                      actionButton: buildCombatInfluenceCardActionNode(
                        rc,
                        encPlayer.name,
                        card.name || "Opponent",
                        encPlayer.index !== viewer.index
                      ),
                    })
                  )
                )
              )
            : null,
          !isOtherConsumableActor
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
                text: `Waiting for ${consumableActor.name} to choose whether to use their consumable weapon(s)...`,
              })
        )
      )
    );
  }

  // Stage 1B: Pre-Roll Strike Post-Roll Window (Sagittae 1(R) — Twist Of Fate only)
  if (stage === "combat_pre_strike_post_roll") {
    const isPvp = Boolean(pend.isPvp);
    const strikerName = pend.pvpStrikerName || encPlayer.name;
    const targetName = pend.pvpTargetName || card.name || "Opponent";
    const strikeList = Array.isArray(pend.strikeNames) && pend.strikeNames.length > 0 ? pend.strikeNames : ["Sagittae"];
    const strikeLabel = strikeList.join(", ");
    const rawW = Number(pend.strikeWounds) || 0;
    const ignW = Number(pend.ignoreWounds) || 0;
    const netW = Number(pend.netWoundsAfterArmor) || 0;
    const armorSources = Array.isArray(pend.armorSources) ? pend.armorSources : [];
    const armorLabelStr =
      armorSources.length > 0
        ? armorSources.join(", ")
        : ignW > 0
        ? `Armor (Ignore ${ignW} Wound${ignW === 1 ? "" : "s"})`
        : "None";

    const singleReroll = getEligibleRerollTargets(pend).length === 1;
    const postCards = ((viewer && viewer.influence) || []).filter((c) => String(c.name || "") === "Twist Of Fate");
    const diceSummary = (pend.playerDiceObjs || [])
      .map((d) =>
        d.sign === 0 ? `${d.label}: 🛡️[${d.roman}]` : `${d.label}: [${d.roman}] Wnd`
      )
      .join(", ");

    let targetGuardCount = 0;
    if (isPvp && pend.pvpTargetIndex != null) {
      const targetPl =
        (gs.players || []).find((p) => p.index === pend.pvpTargetIndex) || (gs.players || [])[pend.pvpTargetIndex];
      targetGuardCount = targetPl && Array.isArray(targetPl.guards) ? targetPl.guards.length : 0;
    }

    let statusBorderColor = "#ea580c";
    let statusBg = "#fff7ed";
    let statusFg = "#7c2d12";
    let outcomeText = "";
    let confirmBtnText = "⚔️ Confirm Pre-Roll Strike & Roll Main Combat";

    if (isPvp) {
      const killsDriver = netW > targetGuardCount;
      if (netW <= 0) {
        statusBorderColor = "#ca8a04";
        statusBg = "#fefce8";
        statusFg = "#713f12";
        outcomeText = `🛡️ ${strikeLabel} Pre-Roll Strike (${strikerName} → ${targetName}): ${rawW} Raw Wound(s), ${ignW} Blocked by ${armorLabelStr} → 0 Unblocked Wounds. Main PvP combat rolls next.`;
        confirmBtnText = "🛡️ Confirm Strike Blocked & Continue";
      } else if (killsDriver) {
        statusBorderColor = "#dc2626";
        statusBg = "#fef2f2";
        statusFg = "#7f1d1d";
        outcomeText = `💀 ${strikeLabel} Pre-Roll Strike (${strikerName} → ${targetName}): ${rawW} Raw Wound(s), ${ignW} Blocked by ${armorLabelStr} → ${netW} Unblocked Wound(s) (exceeds ${targetGuardCount} Guard(s))! ${targetName}'s Driver must roll on the Driver Fate Chart!`;
        confirmBtnText = `💀 Confirm ${netW} Pre-Roll Wnd(s) & ${targetName}'s Fate Roll`;
      } else {
        statusBorderColor = "#ea580c";
        statusBg = "#fff7ed";
        statusFg = "#7c2d12";
        outcomeText = `🛡️ ${strikeLabel} Pre-Roll Strike (${strikerName} → ${targetName}): ${rawW} Raw Wound(s), ${ignW} Blocked by ${armorLabelStr} → ${netW} Absorbed by ${targetName}'s Hired Guard(s). Main PvP combat rolls next.`;
        confirmBtnText = `🛡️ Confirm ${netW} Guard Casualty & Continue`;
      }
      if (
        isOtherPlayerEncounter &&
        (!viewer || (viewer.index !== pend.pvpTargetIndex && viewer.index !== pend.pvpStrikerIndex))
      ) {
        confirmBtnText = "✅ Pass Intervention / Confirm Pre-Roll Strike";
      }
    } else {
      const defeatsNpc = Boolean(pend.preStrikeDefeatsNpc);
      const capVal = Number(pend.preStrikeCapacity) || 0;
      const capMode = pend.preStrikeCapacityMode === "x" ? "X" : "(R)";
      if (defeatsNpc) {
        statusBorderColor = "#16a34a";
        statusBg = "#f0fdf4";
        statusFg = "#14532d";
        outcomeText = `🏆 ${strikeLabel} Pre-Roll Strike Defeats ${targetName}! Rolled ${rawW} Wound(s) (${ignW} Blocked) = ${netW} Unblocked Wound(s), exceeding ${targetName}'s capacity (${capVal} ${capMode}) — instant Victory without rolling main combat!`;
        confirmBtnText = `🏆 Confirm Pre-Roll Victory vs. ${targetName}!`;
      } else if (netW > 0) {
        const reducedBy = Math.min(capVal, netW);
        outcomeText = `🏹 ${strikeLabel} Pre-Roll Strike (${netW} Unblocked Wound(s)): ${targetName} suffers -${reducedBy} ${capMode} (${capVal} → ${Math.max(0, capVal - reducedBy)} ${capMode}) before the main combat dice roll!`;
        confirmBtnText = `⚔️ Confirm -${reducedBy} Enemy ${capMode} & Roll Main Combat`;
      } else {
        statusBorderColor = "#ca8a04";
        statusBg = "#fefce8";
        statusFg = "#713f12";
        outcomeText = `🏹 ${strikeLabel} Pre-Roll Strike inflicted 0 Wounds on ${targetName}. Main combat rolls at full strength next.`;
        confirmBtnText = "⚔️ Confirm 0 Wounds & Roll Main Combat";
      }
      if (isOtherPlayerEncounter) {
        confirmBtnText = "✅ Pass Intervention / Confirm Pre-Roll Strike";
      }
    }

    const strikerDiceLabel = isPvp ? `${strikerName}'s` : merchantLabel;
    return el(
      "div",
      { id: "pending-encounter-panel", className: "panel", style: { borderColor: statusBorderColor } },
      el(
        "h3",
        { className: "panel-title" },
        el("span", {
          text: `🏹 Pre-Roll Strike (${strikeLabel}): ${strikerName} → ${targetName} (${netW} Unblocked Wnd${
            netW === 1 ? "" : "s"
          })${isOtherPlayerEncounter ? " [Intervention / Pre-Strike Window]" : ""}`,
        })
      ),
      el(
        "div",
        {
          style: {
            padding: "0.65rem 0.85rem",
            background: statusBg,
            border: `1.5px solid ${statusBorderColor}`,
            borderRadius: "4px",
            fontSize: "0.85rem",
            color: statusFg,
            marginBottom: "0.85rem",
            boxShadow: "var(--bevel-sunken)",
          },
        },
        el("div", { style: { fontWeight: "700", marginBottom: "0.25rem" }, text: outcomeText }),
        pend.encounterSource
          ? el("div", {
              style: { fontSize: "0.78rem", color: "#92400e", marginBottom: "0.25rem", fontWeight: "700" },
              text: `📍 Triggered By: ${pend.encounterSource}`,
            })
          : null,
        el("div", {
          style: { fontSize: "0.78rem", color: "var(--text-main)" },
          text: `Pre-Strike Rolls: ${diceSummary || "None"}  |  Target Armor: ${armorLabelStr}`,
        })
      ),
      renderInlineClickableDiceRow(pend, viewer, strikerDiceLabel),
      buildArmedDieBannerNode() ? el("div", { style: { marginBottom: "0.7rem" } }, buildArmedDieBannerNode()) : null,
      postCards.length > 0
        ? el(
            "div",
            { style: { marginBottom: "0.9rem" } },
            el("div", {
              style: { fontSize: "0.84rem", fontWeight: "700", color: "var(--gold-bright)", marginBottom: "0.45rem" },
              text: "🃏 Only 'Twist Of Fate' May Be Played During Pre-Roll Strikes:",
            }),
            el(
              "div",
              { className: "phys-cards-grid compact-sidebar-grid" },
              ...postCards.map((rc) => {
                const isArmed = Boolean(appState.armedDieAction && appState.armedDieAction.cardId === rc.id);
                return renderPhysicalInfluenceCardNode(rc, {
                  actionButton: el("button", {
                    className: `btn btn-sm ${isArmed ? "btn-crimson" : "btn-primary"}`,
                    style: { width: "100%" },
                    text: singleReroll
                      ? "🎲 Twist Of Fate — Re-Roll Die"
                      : isArmed
                      ? "👆 Click Any Die Above!"
                      : "🎲 Click a Die Above to Re-Roll",
                    onClick: () => triggerTwistOfFateOrArm(gs, rc),
                  }),
                });
              })
            )
          )
        : null,
      el(
        "div",
        { style: { display: "flex", gap: "0.65rem", alignItems: "center" } },
        viewer
          ? el("button", {
              className: pend.preStrikeDefeatsNpc ? "btn btn-primary" : "btn btn-crimson",
              text: confirmBtnText,
              onClick: () => sendGameAction({ type: "resolve_encounter", decision: "finalize_pre_strike" }),
            })
          : el("span", {
              style: { fontSize: "0.82rem", color: "var(--text-muted)", fontStyle: "italic" },
              text: "👁️ Spectating pre-roll strike resolution",
            })
      )
    );
  }

  // Stage 2: Combat Post-Roll Influence Opportunity (Gladiator's Intervention, Mercenary Ambush, Flying Chamber Pot, Twist Of Fate)
  if (stage === "combat_post_roll") {
    const isPvp = Boolean(pend.isPvp);
    const pCP = Number(pend.playerCP) || 0;
    const oCP = Number(pend.oppCP) || 0;
    const isVictory = pCP > oCP;
    const isTie = pCP === oCP;
    const defPlayer =
      isPvp && pend.pvpDefenderIndex != null
        ? (gs.players || []).find((p) => p.index === pend.pvpDefenderIndex) || (gs.players || [])[pend.pvpDefenderIndex]
        : null;
    const oppName = card.name || (defPlayer && defPlayer.name) || "Opponent";
    const losingPlayer = isPvp && isVictory ? defPlayer : encPlayer;
    const losingName = (losingPlayer && losingPlayer.name) || (isVictory ? oppName : encPlayer.name);
    const rawWounds = isTie ? 0 : isVictory ? (isPvp ? pCP - oCP : 0) : oCP - pCP;
    const ignoreWounds = isPvp && isVictory ? Number(pend.oppIgnoreWounds) || 0 : Number(pend.ignoreWounds) || 0;
    const netWounds = Math.max(0, rawWounds - ignoreWounds);
    const guardCount =
      isPvp && isVictory
        ? Array.isArray(pend.oppGuardNames)
          ? pend.oppGuardNames.length
          : ((losingPlayer && losingPlayer.guards) || []).length
        : (encPlayer.guards || []).length;
    const survivesByArmor = !isTie && rawWounds > 0 && netWounds <= 0;
    const survivesByGuard = !isTie && netWounds > 0 && netWounds <= guardCount;
    const armorSources =
      isPvp && isVictory
        ? Array.isArray(pend.oppArmorSources)
          ? pend.oppArmorSources
          : []
        : Array.isArray(pend.armorSources)
        ? pend.armorSources
        : [];
    const armorLabelStr =
      armorSources.length > 0
        ? armorSources.join(", ")
        : ignoreWounds > 0
        ? `Armor (Ignore ${ignoreWounds} Wound${ignoreWounds === 1 ? "" : "s"})`
        : "None";
    const equipNotes = Array.isArray(pend.equipmentNotes) ? pend.equipmentNotes : [];
    const oppEquipNotes = isPvp && Array.isArray(pend.oppEquipmentNotes) ? pend.oppEquipmentNotes : [];
    const singleReroll = getEligibleRerollTargets(pend).length === 1;

    const postCards = ((viewer && viewer.influence) || []).filter((c) => {
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

    let statusLabel = "";
    if (isPvp) {
      if (isTie) {
        statusLabel = "TIE (NO WOUNDS — NO SPOILS)";
      } else if (survivesByArmor) {
        statusLabel = `${isVictory ? encPlayer.name : oppName} LEADS (${losingName} ARMOR BLOCKED WOUNDS)`;
      } else if (survivesByGuard) {
        statusLabel = `${isVictory ? encPlayer.name : oppName} LEADS (${losingName} GUARD ABSORBED WOUND)`;
      } else {
        statusLabel = `${isVictory ? encPlayer.name : oppName} WINS — ${losingName} TO FATE CHART`;
      }
    } else {
      statusLabel = isVictory
        ? "VICTORY"
        : isTie
        ? "TIE (SURVIVED — NO BONUS)"
        : survivesByArmor
        ? `SURVIVED (${armorLabelStr.toUpperCase()} BLOCKED WOUNDS)`
        : survivesByGuard
        ? "DEFEAT — SURVIVED (GUARD ABSORBED WOUND)"
        : "DEFEAT (ROLL ON DEFEAT CHART)";
    }

    const statusBorderColor = isPvp
      ? isTie || survivesByArmor
        ? "#ca8a04"
        : survivesByGuard
        ? "#ea580c"
        : isVictory
        ? "#16a34a"
        : "#dc2626"
      : isVictory
      ? "#16a34a"
      : isTie || survivesByArmor
      ? "#ca8a04"
      : survivesByGuard
      ? "#ea580c"
      : "#dc2626";

    let outcomeSummaryText = "";
    if (isPvp) {
      if (isTie) {
        outcomeSummaryText = `⚖️ Current PvP Outcome: Tie (${pCP} CP vs. ${oCP} CP) — Neither Driver suffers Wounds, and no Spoils are claimed.`;
      } else {
        const winnerLbl = isVictory ? encPlayer.name : oppName;
        const turnLossSuffix = !isVictory ? ` (${encPlayer.name}'s turn ends)` : "";
        if (survivesByArmor) {
          outcomeSummaryText = `🛡️ Current PvP Outcome: ${winnerLbl} leads (${pCP} CP vs. ${oCP} CP)${turnLossSuffix}, inflicting ${rawWounds} Wound(s) on ${losingName}, but ${armorLabelStr} blocked all Wounds! No Driver Fate roll or Spoils.`;
        } else if (survivesByGuard) {
          outcomeSummaryText = `🛡️ Current PvP Outcome: ${winnerLbl} leads (${pCP} CP vs. ${oCP} CP)${turnLossSuffix} — ${rawWounds} Raw Wound(s) on ${losingName}, ${ignoreWounds} Blocked by ${armorLabelStr}, ${netWounds} Absorbed by ${losingName}'s Hired Guard(s)! No Driver Fate roll or Spoils.`;
        } else {
          outcomeSummaryText = `⚔️ Current PvP Outcome: ${winnerLbl} defeats ${losingName} (${pCP} CP vs. ${oCP} CP)${turnLossSuffix} — ${rawWounds} Raw Wound(s), ${ignoreWounds} Blocked by ${armorLabelStr} (${netWounds} Unblocked). ${losingName}'s Driver must roll on the Driver Fate Chart (${winnerLbl} claims Spoils)!`;
        }
      }
    } else if (isVictory) {
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

    let confirmBtnText = "✅ Confirm Combat Victory";
    if (isOtherPlayerEncounter && !(isPvp && viewer && viewer.index === pend.pvpDefenderIndex)) {
      confirmBtnText = "✅ Pass Intervention / Confirm Combat Result";
    } else if (isTie) {
      confirmBtnText = isPvp ? "✅ Confirm PvP Tie (No Wounds, No Spoils)" : "✅ Confirm Combat Tie (Survive, No Bonus)";
    } else if (isPvp) {
      if (isVictory) {
        confirmBtnText =
          survivesByArmor || survivesByGuard
            ? `✅ Confirm PvP Victory (${oppName} Survived — No Spoils)`
            : `⚔️ Confirm PvP Victory & ${oppName}'s Fate Roll`;
      } else {
        confirmBtnText =
          survivesByArmor || survivesByGuard
            ? `🛡️ Confirm PvP Outcome (${encPlayer.name} Survived — Turn Ends)`
            : `💀 Confirm PvP Outcome & ${encPlayer.name}'s Fate Roll`;
      }
    } else if (!isVictory) {
      confirmBtnText = survivesByArmor
        ? `🛡️ Confirm Survival (${armorLabelStr} Blocked Wounds — No Defeat Roll)`
        : survivesByGuard
        ? "🛡️ Confirm Survival (Guard Absorbed Wound — No Defeat Roll)"
        : "💀 Confirm Combat Result & Proceed to Driver Fate Roll";
    }

    return el(
      "div",
      { id: "pending-encounter-panel", className: "panel", style: { borderColor: statusBorderColor } },
      el(
        "h3",
        { className: "panel-title" },
        el("span", {
          text: `${isPvp ? "⚔️ PvP Combat Dice Rolled" : "⚔️ Combat Dice Rolled"}: ${encPlayer.name} (${pCP} CP) vs. ${oppName} (${oCP} CP) — ${statusLabel}${
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
          )})  |  ${isPvp ? oppName : "Opponent"} Rolls: ${oDiceSummary || "None"} (Flat ${formatSignedFlat(pend.oppFlat)})`,
        }),
        equipNotes.length > 0
          ? el("div", {
              style: { fontSize: "0.78rem", color: "#78350f", marginTop: "0.3rem", fontWeight: "700" },
              text: `🛡️⚔️ ${isPvp ? `${encPlayer.name}'s` : "Active"} Guard & Weapon Effects: ${equipNotes.join(" • ")}`,
            })
          : null,
        oppEquipNotes.length > 0
          ? el("div", {
              style: { fontSize: "0.78rem", color: "#78350f", marginTop: "0.2rem", fontWeight: "700" },
              text: `🛡️⚔️ ${oppName}'s Guard & Weapon Effects: ${oppEquipNotes.join(" • ")}`,
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
                ? `🃏 Intervene in ${isPvp ? `${encPlayer.name} vs. ${oppName}` : `${encPlayer.name}'s Combat`}! Click a Die Above or Play a Post-Roll Influence Card:`
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
                      text: singleReroll
                        ? "🎲 Twist Of Fate — Re-Roll Die"
                        : isArmed
                        ? "👆 Click Any Die Above!"
                        : "🎲 Click a Die Above to Re-Roll",
                      onClick: () => triggerTwistOfFateOrArm(gs, rc),
                    }),
                  });
                }
                return renderPhysicalInfluenceCardNode(rc, {
                  actionButton: buildCombatInfluenceCardActionNode(
                    rc,
                    encPlayer.name,
                    oppName,
                    isOtherPlayerEncounter || isPvp
                  ),
                });
              })
            )
          )
        : null,
      el(
        "div",
        { style: { display: "flex", gap: "0.65rem", alignItems: "center" } },
        viewer
          ? el("button", {
            className: isVictory || isTie || survivesByArmor ? "btn btn-primary" : "btn btn-crimson",
            text: confirmBtnText,
            onClick: () => sendGameAction({ type: "resolve_encounter", decision: "finalize_combat" }),
          })
          : el("span", {
            style: { fontSize: "0.82rem", color: "var(--text-muted)", fontStyle: "italic" },
            text: "👁️ Spectating encounter resolution",
          })
      )
    );
  }

  // Stage 3A: Driver Wounded — Prompt Player to Roll on the Driver Fate (Death) Chart
  if (stage === "driver_fate_pre_roll") {
    const postChartCards = ((viewer && viewer.influence) || []).filter(
      (c) => c.name === "Lucky Break" || c.name === "Twist Of Fate"
    );
    const pvpSpoilsOwner = pend.pvpWinnerName || "Winner";
    return el(
      "div",
      { id: "pending-encounter-panel", className: "panel", style: { borderColor: "#b91c1c" } },
      el(
        "h3",
        { className: "panel-title" },
        el("span", {
          text: pend.isPvp
            ? `💀 PvP Defeat (${pend.pvpLoserName || encPlayer.name} Wounded) — Roll on the Driver Fate Chart!`
            : `💀 Driver Wounded in Combat — Roll on the Driver Fate (Death) Chart!`,
        })
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
        el("strong", { text: pend.isPvp ? `⚔️ PvP Unblocked Wound (Spoils → ${pvpSpoilsOwner}): ` : "⚔️ Unblocked Wound to Driver: " }),
        pend.isPvp
          ? `${pend.pvpLoserName || encPlayer.name} suffered ${pend.rawWounds} wound(s) against ${pvpSpoilsOwner} (${
              pend.playerCP
            } CP vs. ${pend.oppCP} CP; ${pend.ignoreWounds || 0} blocked${
              pend.casualties && pend.casualties.length ? `, ${pend.casualties.join(", ")}` : ""
            }). Roll 1 Rome Die (1(R)) on the Death Chart below — ${pvpSpoilsOwner} claims any Goods, Denarii, or Influence lost!`
          : `${encPlayer.name} lost combat (${pend.playerCP} CP vs. ${card.name}'s ${pend.oppCP} CP), suffering ${pend.rawWounds} wound(s) (${
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
          el("div", {
            style: { color: "var(--text-main)" },
            text: pend.isPvp
              ? `${pvpSpoilsOwner} takes all Goods on your Cart; your night ends immediately.`
              : "Lose all Goods on Cart; your night ends immediately.",
          })
        ),
        el(
          "div",
          { style: { padding: "0.5rem", background: "#fffbeb", borderRadius: "4px", border: "1px solid #d97706" } },
          el("strong", { style: { color: "#92400e" }, text: "Roll I — Left for dead:" }),
          el("div", {
            style: { color: "var(--text-main)" },
            text: pend.isPvp
              ? `${pvpSpoilsOwner} takes all Goods on your Cart; your night continues.`
              : "Lose all Goods on Cart; your night continues.",
          })
        ),
        el(
          "div",
          { style: { padding: "0.5rem", background: "#fefce8", borderRadius: "4px", border: "1px solid #ca8a04" } },
          el("strong", { style: { color: "#713f12" }, text: "Roll II — Beaten & mugged:" }),
          el("div", {
            style: { color: "var(--text-main)" },
            text: pend.isPvp
              ? `${pvpSpoilsOwner} takes all your Denarii; your night continues.`
              : "Lose all Denarii; your night continues.",
          })
        ),
        el(
          "div",
          { style: { padding: "0.5rem", background: "#f0fdf4", borderRadius: "4px", border: "1px solid #16a34a" } },
          el("strong", { style: { color: "#15803d" }, text: "Roll III — Begged for mercy:" }),
          el("div", {
            style: { color: "var(--text-main)" },
            text: pend.isPvp
              ? `${pvpSpoilsOwner} takes all your Influence cards; your night continues.`
              : "Lose all Influence cards; your night continues.",
          })
        )
      ),
      postChartCards.length > 0
        ? el("div", {
            style: { fontSize: "0.82rem", color: "var(--gold-bright)", marginBottom: "0.75rem", fontWeight: "600" },
            text: `🃏 You hold ${postChartCards.map((c) => `'${c.name}'`).join(", ")} — after rolling the Death Chart die, you can modify or re-roll it immediately!`,
          })
        : null,
      viewer && !isOtherPlayerEncounter
        ? el("button", {
          className: "btn btn-crimson",
          style: { fontSize: "0.95rem", padding: "0.55rem 1.25rem" },
          text: "🎲 Roll Driver Fate Die (1(R)) on Death Chart",
          onClick: () => sendGameAction({ type: "resolve_encounter", decision: "roll_driver_fate" }),
        })
        : el("div", {
          style: { fontSize: "0.84rem", color: "var(--text-muted)", fontStyle: "italic" },
          text: `Waiting for ${encPlayer.name} to roll on the Driver Fate Chart...`,
        })
    );
  }

  // Stage 3B / Chart Post-Roll: Modify or Re-Roll Driver Fate / Angry Mob / Theater Troupe / Soothsayer Roll
  if (stage === "driver_fate_post_roll" || stage === "chart_post_roll") {
    const cType = pend.chartType || "death";
    const cRoll = Number(pend.chartRoll) || 0;
    const rom = toRomanDieSymbol(cRoll);
    const singleReroll = getEligibleRerollTargets(pend).length === 1;
    const postChartCards = ((viewer && viewer.influence) || []).filter((c) => {
      const nm = String(c.name || "");
      if (nm === "Twist Of Fate") return true;
      if (nm === "Lucky Break" && cType !== "soothsayer") return true;
      if (viewer && !isOtherPlayerEncounter && cType === "mob" && nm === "Man Of The People") return true;
      if (viewer && !isOtherPlayerEncounter && cType === "theater" && nm === "Dramaturge") return true;
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
              ? `💀 ${encPlayer.name}'s Driver Fate ${pend.isPvp ? `(PvP Spoils → ${pend.pvpWinnerName || "Winner"})` : "(Death Chart)"} Roll: Rolled [${rom}]${
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
        el("strong", {
          text: `Current Outcome for ${encPlayer.name}${pend.isPvp ? ` (Spoils → ${pend.pvpWinnerName || "Winner"})` : ""} (Roll = ${rom}): `,
        }),
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
                : "🃏 Post-Roll Influence Cards in Hand (Modify / Re-Roll the Die):",
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
                      text: singleReroll
                        ? "🎲 Twist Of Fate — Re-Roll Die"
                        : isArmed
                        ? "👆 Click Die Above to Re-Roll!"
                        : "🎲 Click Die Above to Re-Roll",
                      onClick: () => triggerTwistOfFateOrArm(gs, rc),
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
      viewer
        ? el("button", {
          className: "btn btn-primary",
          text: isOtherPlayerEncounter ? "✅ Pass Intervention / Confirm Roll Outcome" : "✅ Confirm Roll Outcome",
          onClick: () =>
            sendGameAction({
              type: "resolve_encounter",
              decision: stage === "driver_fate_post_roll" ? "finalize_driver_fate" : "finalize_chart_roll",
            }),
        })
        : el("span", {
          style: { fontSize: "0.82rem", color: "var(--text-muted)", fontStyle: "italic" },
          text: "👁️ Spectating roll resolution",
        })
    );
  }

  // Stage 5 / 6: Demand Post-Roll (e.g., Scorpus / Sabinus) or Stadium Gambling Post-Roll
  if (stage === "demand_post_roll" || stage === "gamble_post_roll") {
    const twistCards = ((viewer && viewer.influence) || []).filter((c) => String(c.name || "") === "Twist Of Fate");
    const singleReroll = getEligibleRerollTargets(pend).length === 1;
    const gambleRolls = Array.isArray(pend.gambleRolls) ? pend.gambleRolls : [];
    const romDisplay =
      stage === "demand_post_roll"
        ? toRomanDieSymbol(Number(pend.demandRoll) || 0)
        : gambleRolls.map((v) => toRomanDieSymbol(Number(v) || 0)).join(" + ");
    const titleStr =
      stage === "demand_post_roll"
        ? `📜 ${encPlayer.name}'s ${card.name || "Encounter"} Demand Roll: Rolled [${romDisplay}]${
        viewer && isOtherPlayerEncounter ? " [Your Intervention Window]" : ""
          }`
        : `🎲 ${encPlayer.name}'s Stadium Gambling (${pend.cell || "Rome"}): Rolled [${romDisplay}]${
        viewer && isOtherPlayerEncounter ? " [Your Intervention Window]" : ""
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
                ? singleReroll
                  ? `🃏 Intervene on ${encPlayer.name}'s Roll with Twist Of Fate:`
                  : `🃏 Intervene on ${encPlayer.name}'s Roll! Click the Die Above to Force a Re-Roll:`
                : singleReroll
                ? "🃏 Play Twist Of Fate to Immediately Re-Roll This Die:"
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
                    text: singleReroll
                      ? "🎲 Twist Of Fate — Re-Roll Die"
                      : isArmed
                      ? "👆 Click a Die Above to Re-Roll!"
                      : "🎲 Click a Die Above to Re-Roll",
                    onClick: () => triggerTwistOfFateOrArm(gs, rc),
                  }),
                });
              })
            )
          )
        : null,
      viewer
        ? el("button", {
          className: "btn btn-primary",
          text: isOtherPlayerEncounter ? "✅ Pass Intervention / Confirm Roll Outcome" : "✅ Confirm Roll Outcome",
          onClick: () =>
            sendGameAction({
              type: "resolve_encounter",
              decision: stage === "demand_post_roll" ? "finalize_demand_roll" : "finalize_gamble_roll",
            }),
        })
        : el("span", {
          style: { fontSize: "0.82rem", color: "var(--text-muted)", fontStyle: "italic" },
          text: "👁️ Spectating roll resolution",
        })
    );
  }

  // Stage 1: Pre-Decision (Encounter Drawn — Player can play Pre-Roll Combat or Favor/Plea Influence cards)
  const canFight = Boolean(pend.canInitiateCombat);
  const combatMandatory = Boolean(pend.combatMandatory);
  const hasDog =
    Boolean(viewer) &&
    !isOtherPlayerEncounter &&
    (((viewer.cart || []).some((c) => c.name === "Trained Dog")) ||
      ((viewer.influence || []).some((c) => c.name === "Trained Dog")));
  const hasPlea =
    Boolean(viewer) &&
    !isOtherPlayerEncounter &&
    (viewer.influence || []).some((c) => (c.name || "").includes("Plea"));
  const hasCasusBelli =
    Boolean(viewer) &&
    !isOtherPlayerEncounter &&
    !canFight &&
    !combatMandatory &&
    (Boolean(pend.hasCasusBelliCard) || (viewer.influence || []).some((c) => c.name === "Casus Belli"));

  const demandKind = getActiveDemandKind(pend);
  const combatAvailableNow = Boolean(canFight || combatMandatory || pend.combatThreatened);
  const reactionInfluenceCards = ((viewer && viewer.influence) || []).filter((c) => {
    const nm = String(c.name || "");
    if (isOtherPlayerEncounter) {
      return combatAvailableNow && (nm === "Mercenary Ambush" || nm === "Distraction");
    }
    if (nm === "Mercenary Ambush" || nm === "Distraction") {
      return combatAvailableNow;
    }
    if (nm === "Casus Belli") {
      return !pend.isPvp && !combatAvailableNow;
    }
    if (nm === "Trained Dog") {
      return demandKind === "cash";
    }
    if (nm.includes("Plea")) {
      return demandKind === "goods";
    }
    return (
      nm === "Thug" ||
      nm === "Supplicant" ||
      nm === "Minor Supplicant" ||
      nm.includes("Favor")
    );
  });

  const postRollCombatCardsHeld = ((viewer && viewer.influence) || []).filter((c) => {
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
    if (c.preRollStrike && c.dice) {
      parts.push(`Pre-Roll Strike ${c.dice}(R)`);
    } else if (c.dice) {
      parts.push(`+${c.dice}(R)`);
    }
    if (c.negDice) parts.push(`-${c.negDice}(R)`);
    if (c.flat) parts.push(formatSignedFlat(c.flat) + " CP");
    if (c.ignoreWoundsFlat) parts.push(`Ignore ${c.ignoreWoundsFlat} Wound${c.ignoreWoundsFlat === 1 ? "" : "s"}`);
    if (c.ignoreWoundsDice) parts.push(`Ignore ${c.ignoreWoundsDice}(R) Wound(s)`);
    if (c.consumable) parts.push("Optional — Destroyed if Used");
    if (parts.length > 0) {
      gearCombatEffects.push(`${it.item || it.name || "Gear"} (${parts.join(", ")})`);
    }
  });

  const rTypeCur = pend.reaction || pend.reactionType || "";
  const isNoContraband = rTypeCur === "no_contraband";

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
  } else if (isNoContraband) {
    combatRuleBanner = el(
      "div",
      {
        style: {
          padding: "0.55rem 0.75rem",
          background: "#f0fdf4",
          border: "1.5px solid #16a34a",
          borderRadius: "4px",
          fontSize: "0.82rem",
          color: "#14532d",
          marginBottom: "0.75rem",
          boxShadow: "var(--bevel-sunken)",
        },
      },
      el("strong", { text: "✓ Contraband Inspection Passed: " }),
      card.actionText ||
        "Your cart carries none of the inspected contraband. Click '✓ Pass Inspection (No Contraband)' (or click the ✓ tier on the card) to wave through peacefully."
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
          pend.deck && ENCOUNTER_DECK_PROFILES[String(pend.deck).toLowerCase()]
            ? el("button", {
                type: "button",
                className: "btn btn-sm",
                style: { padding: "0.14rem 0.5rem", fontSize: "0.75rem" },
                title: "Inspect Encounter Deck mechanics, Roman history, and live faction card counts",
                text: `🃏 ${(pend.deck || "").toUpperCase()} Deck Guide`,
                onClick: () => openEncounterDecksOverviewModal(gs, pend.deck),
              })
            : null,
          el("span", { className: "badge", text: `Effective Favor: ${pend.favorScore > 0 ? `+${pend.favorScore}` : pend.favorScore}` }),
          (() => {
            const rTypeKey =
              pend.reaction ||
              pend.reactionType ||
              (pend.matchedTier && (pend.matchedTier.reactionType || pend.matchedTier.type || pend.matchedTier.effect)) ||
              "";
            const info = getEncounterReactionInfo(rTypeKey || pend.matchedTier);
            const sym = pend.matchedTier
              ? formatReactionTypeSymbol(pend.matchedTier)
              : formatReactionTypeSymbol(rTypeKey);
            const condPrefix = pend.matchedTier
              ? `${formatReactionCondition(pend.matchedTier.condition || pend.matchedTier.cond)} → `
              : "";
            return el(
              "span",
              {
                className: "badge",
                title: `${info.label}: ${info.detail}`,
                style: { display: "inline-flex", alignItems: "center", gap: "0.24rem", flexWrap: "wrap" },
              },
              `Active Tier: ${condPrefix}`,
              sym,
              ` (${info.label})`
            );
          })(),
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
              (() => {
                const rTypeKey =
                  pend.reaction ||
                  pend.reactionType ||
                  (pend.matchedTier && (pend.matchedTier.reactionType || pend.matchedTier.type || pend.matchedTier.effect)) ||
                  "";
                const info = getEncounterReactionInfo(rTypeKey || pend.matchedTier);
                const sym = pend.matchedTier
                  ? formatReactionTypeSymbol(pend.matchedTier)
                  : formatReactionTypeSymbol(rTypeKey);
                return el(
                  "div",
                  {
                    style: {
                      fontSize: "0.8rem",
                      marginBottom: "0.3rem",
                      color: "#3f2814",
                      lineHeight: "1.45",
                    },
                  },
                  el("strong", { text: "• Active Tier Icon (" }),
                  el("span", {
                    style: { display: "inline-flex", alignItems: "center", gap: "0.15rem", verticalAlign: "-0.12em" },
                    text: sym,
                  }),
                  el("strong", { text: ` = ${info.label}): ` }),
                  el("span", { text: `${info.detail}.` })
                );
              })(),
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
                  if (rType === "no_contraband") {
                    return "✓ Pass Inspection (No Contraband)";
                  }
                  if (rType === "deck_quest_demand") {
                    return "(DECK_ICON)(QUEST_ICON)! Draw & Accept Top Missiones Card (Unseen)";
                  }
                  if (rType === "deck_quest_offer") {
                    return "(DECK_ICON)(QUEST_ICON)? Draw & Accept Top Missiones Card (Unseen)";
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
          canFight && viewer
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
            : canFight
              ? el("span", {
                style: { fontSize: "0.82rem", color: "var(--text-muted)", fontStyle: "italic" },
                text: "👁️ Spectating encounter decision",
              })
            : null,
          !isOtherPlayerEncounter && !combatMandatory && !isNoContraband
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

function renderPendingMissionOverflowPanel(gs, viewer) {
  const missions = (viewer && Array.isArray(viewer.missions) ? viewer.missions : []);
  if (missions.length <= MAX_ACTIVE_MISSIONS) return null;
  const ovf = (viewer && viewer.pendingMissionOverflow) || {};
  const allSooth = areAllMissionsSoothsayer(missions);
  const triggerText = ovf.newMissionName
    ? `You took on "${ovf.newMissionName}" (${ovf.sourceLabel || "Mission"}), bringing you to ${missions.length}/${MAX_ACTIVE_MISSIONS} active missions.`
    : `You currently hold ${missions.length}/${MAX_ACTIVE_MISSIONS} active missions.`;
  const soothRuleText = allSooth
    ? "All 6 active missions are Soothsayer prophecies — pick any 1 Soothsayer mission to cancel at no penalty."
    : "Soothsayer missions are locked unless all 6 active missions are Soothsayer missions — pick 1 Starting or Encounter mission to cancel.";
  return el(
    "div",
    { className: "panel", style: { borderColor: "#b45309", background: "rgba(255, 247, 237, 0.96)" } },
    el(
      "h3",
      { className: "panel-title" },
      el("span", {
        text: `📜 Active Mission Limit (${missions.length}/${MAX_ACTIVE_MISSIONS}) — Choose 1 Mission to Cancel`,
      }),
      el("button", {
        type: "button",
        className: "btn btn-sm btn-primary",
        text: "⚖️ Choose Mission to Cancel",
        onClick: () => openPendingMissionOverflowModal(gs, viewer),
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
        text: `${triggerText} ${soothRuleText} You cannot end your turn until you hold at most ${MAX_ACTIVE_MISSIONS} active missions.`,
      }),
      el("button", {
        type: "button",
        className: "btn btn-sm btn-crimson",
        text: "📜 Pick 1 of 6 Missions to Cancel",
        onClick: () => openPendingMissionOverflowModal(gs, viewer),
      })
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
      disabled: hasMissionOverflow(viewer, gs),
      title: hasMissionOverflow(viewer, gs)
        ? "Cannot finish Clean-Up with more than 5 active missions — cancel 1 mission first"
        : "Finish Clean-Up and advance",
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

function resolveItemPaidPriceIndex(item) {
  if (!item || item.isCatalogPreview || item.isMissionCargo) return -1;
  if (typeof item.purchasePriceIndex === "number") {
    return item.purchasePriceIndex >= 0 && item.purchasePriceIndex <= 4 ? item.purchasePriceIndex : -1;
  }
  return -1;
}

function renderPhysicalMarketGoodCardFaceNode(card, opts = {}) {
  const {
    trackName: explicitTrack = null,
    priceColIndex = -1,
    isPriceIdxDirect = true,
    extraCardClass = "",
    title = "",
    onClick = null,
  } = opts;
  const trackName = explicitTrack || card.track || card.category || "Grain";
  const isGuardTrack = trackName === "Guards" || Number(card.guards) > 0;
  const trackClass = resolveGoodTrackClass(explicitTrack || card);
  const reqBlocks = Math.max(1, Number(card.blocks) || 1);
  const reqGuards = Math.max(1, Number(card.guards) || 1);
  const subtitleText = isGuardTrack
    ? "Guard"
    : card.subtitle
    ? `(${card.subtitle})`
    : card.subcategory || card.category || trackName;

  let combatLineText = null;
  if (isGuardTrack) {
    combatLineText = `${card.combatText || ""}${card.abilityText ? ` & ${card.abilityText}` : ""}`.trim() || null;
  } else if (trackName === "Weapons") {
    combatLineText = card.combatText || "0 CP";
  } else if (card.combatText) {
    combatLineText = card.combatText;
  }

  const blocksSymbols = isGuardTrack ? "▲".repeat(reqGuards) : "■".repeat(reqBlocks);

  return el(
    "div",
    {
      className: `market-good-card ${trackClass}${extraCardClass ? ` ${extraCardClass}` : ""}`,
      style: onClick ? { cursor: "pointer" } : undefined,
      title: title || `Click to view ${card.name} details`,
      onClick: onClick || undefined,
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
        renderGoodPriceTableNode(card, trackName, priceColIndex, isPriceIdxDirect)
      )
    )
  );
}

function renderGoodPriceTableNode(card, trackName, colIndex, isPriceIdxDirect = false) {
  const hasCol =
    colIndex !== null && colIndex !== undefined && colIndex !== "" && Number.isFinite(Number(colIndex)) && Number(colIndex) >= 0;
  const numericCol = hasCol ? Number(colIndex) : -1;
  const activePriceIdx = !hasCol
    ? -1
    : isPriceIdxDirect
    ? Math.max(0, Math.min(4, numericCol))
    : numericCol === 0
    ? 0
    : numericCol === 1
    ? 1
    : numericCol <= 3
    ? 2
    : numericCol === 4
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
            ? renderGoodPriceTableNode(
                item,
                trackName,
                typeof item.marketColIndex === "number"
                  ? item.marketColIndex
                  : item.isCatalogPreview
                  ? -1
                  : resolveItemPaidPriceIndex(item),
                typeof item.marketColIndex !== "number"
              )
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

  const priceHighlightCol =
    typeof g.marketColIndex === "number"
      ? g.marketColIndex
      : g.isCatalogPreview
      ? -1
      : resolveItemPaidPriceIndex(g);
  const priceHighlightDirect = typeof g.marketColIndex !== "number";

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
          buyArr ? renderGoodPriceTableNode(g, "Guards", priceHighlightCol, priceHighlightDirect) : null
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
  if (!g.isCatalogPreview && g.marketColIndex == null && typeof g.purchasePrice === "number") {
    infoRows.push(
      el(
        "div",
        { className: "cart-good-detail-row" },
        el("span", { className: "cart-good-detail-label", text: "Hire Price Paid:" }),
        el("strong", {
          text: g.purchasePrice > 0 ? `${g.purchasePrice}(d)` : "0(d) (Free / Influence)",
        })
      )
    );
  }
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
  const canSellNow = Boolean(
    !readOnly && sellOpt && hasViewerEnteredRomeForDelivery(gs, viewer) && gs.activePlayerIndex === viewer.index
  );

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
          ? renderGoodPriceTableNode(item, trackName, resolveItemPaidPriceIndex(item), true)
          : el("div", {
              className: "mission-cargo-no-sell-note",
              text: `Deliver @ ${item.deliverCell || "Target"}`,
            })
      )
    )
  );

  const externalMetaNodes = [];
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
        hasHireTable ? renderGoodPriceTableNode(g, "Guards", resolveItemPaidPriceIndex(g), true) : null
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
      getViewerPlayer(gs) &&
      targetPlayer.index === getViewerPlayer(gs).index
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
      (() => {
        const fc = targetPlayer.favorCollections || {};
        const frVal = Number((fc.friendly && fc.friendly[fm.key]) || 0);
        const hoVal = Number((fc.hostile && fc.hostile[fm.key]) || 0);
        const otherVal = val - frVal - hoVal;
        const fmt = (n) => (n > 0 ? `+${n}` : String(n));
        return el(
          "div",
          {
            style: {
              display: "flex",
              flexWrap: "wrap",
              gap: "0.45rem",
              marginBottom: "0.5rem",
              fontSize: "0.76rem",
              fontWeight: "700",
            },
          },
          el("span", {
            style: { padding: "0.2rem 0.5rem", borderRadius: "4px", background: "#ecfdf5", border: "1px solid #86efac", color: "#14532d" },
            title: "Cards & outcomes tucked behind cart (Missions/Friendly encounters/Patron). Cleared by Theater Troupe 0.",
            text: `👍 Friendly Collection: ${fmt(frVal)}`,
          }),
          el("span", {
            style: { padding: "0.2rem 0.5rem", borderRadius: "4px", background: "#fef2f2", border: "1px solid #fca5a5", color: "#7f1d1d" },
            title: "Penalties tucked under cart (failed Missions/refusals/combat). Negated by Theater Troupe I.",
            text: `👎 Hostile Collection: ${fmt(hoVal)}`,
          }),
          otherVal !== 0
            ? el("span", {
              style: { padding: "0.2rem 0.5rem", borderRadius: "4px", background: "#f3ead8", border: "1px solid #c29b61", color: "#5c3a12" },
              text: `🏛️ Other / Decrees: ${fmt(otherVal)}`,
            })
            : null
        );
      })(),
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
                const coll = entry.collection || (d >= 0 ? "friendly" : "hostile");
                const collBadge =
                  coll === "friendly"
                    ? "[Friendly]"
                    : coll === "hostile"
                      ? "[Hostile]"
                      : coll && coll.startsWith("theater_clear")
                        ? "[Theater]"
                        : "[Decree]";
                const clearedNote = entry.cleared ? " (Cleared)" : "";
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
                      opacity: entry.cleared ? "0.62" : "1",
                      background: d >= 0 ? "#f0fdf4" : "#fef2f2",
                      border: d >= 0 ? "1px solid #86efac" : "1px solid #fca5a5",
                    },
                  },
                  el(
                    "span",
                    {
                      style: {
                        color: d >= 0 ? "#14532d" : "#7f1d1d",
                        fontWeight: "700",
                        textDecoration: entry.cleared ? "line-through" : "none",
                      },
                    },
                    `${idx + 1}. ${d >= 0 ? `+${absD}` : `-${absD}`} ${gemWord} ${collBadge} — ${entry.reason || "Encounter / Mission"}${clearedNote}`
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
          el(
            "h3",
            { style: { margin: "0", color: "var(--gold-bright)", fontSize: "1.15rem" } },
            createPlayerNameNode(targetPlayer, { iconSize: 20 }),
            `'s Merchant Cart${isViewer ? " (You)" : ""}`
          ),
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

/**
 * Returns true if the player has entered Rome on Turn 1 (or is in a later Night Delivery hour)
 * and is currently in the active Delivery phase (never during gate-selection entry).
 */
function hasViewerEnteredRomeForDelivery(gs, viewer) {
  if (!gs || !viewer) return false;
  if (gs.phase !== "delivery") return false;
  if (!viewer.position || viewer.exitedRome || viewer.nightEnded) return false;
  if (viewer.turnStep === "entry" || viewer.turnStep === "ready") return false;
  if (Number(gs.turn) === 1 && viewer.enteredGateTurn1 === false) return false;
  return true;
}

/**
 * Computes adjacency info and passable move direction from the viewer's current tile to targetCoord.
 */
function computeTileMoveOptsForTarget(gs, viewer, targetCoord) {
  if (!gs || !viewer || !viewer.position || !targetCoord || viewer.position === targetCoord) {
    return { moveDir: null, adjInfo: null };
  }
  const currCellObj = gs.romeBoard && gs.romeBoard[viewer.position];
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
  return { moveDir, adjInfo };
}

/**
 * Resolves exposed tile data or the viewer's scouted top tile preview for a Rome cell.
 */
function getTileModalPreviewData(gs, viewer, coord, cell) {
  if (cell && cell.revealed) return cell.revealed;
  for (const si of (viewer && viewer.scoutedInfo) || []) {
    if (si && si.targetType === "tile" && si.targetKey === coord && si.revealedData) {
      return si.revealedData;
    }
  }
  return null;
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
      hasViewerEnteredRomeForDelivery(gs, viewer) &&
      gs.activePlayerIndex === viewer.index &&
      !viewer.transactedThisTurn &&
      !viewer.gambledThisTurn,
  };
}

/**
 * Returns true if the active merchant currently has at least one legal Night Delivery transaction
 * available on their current revealed tile (sellable Good/Mission match, affordable Forum purchase/hire,
 * or Stadium gamble).
 */
function hasAvailableDeliveryTransactionNow(gs, viewer) {
  if (!hasViewerEnteredRomeForDelivery(gs, viewer)) return false;
  if (gs.activePlayerIndex !== viewer.index) return false;
  if (viewer.transactedThisTurn || viewer.gambledThisTurn) return false;
  if (gs.pendingEncounter || hasPlayerBlockingPrompt(viewer, false, gs)) return false;

  const cell = gs.romeBoard && gs.romeBoard[viewer.position];
  const rev = cell && cell.revealed;
  if (!rev) return false;

  for (const item of viewer.cart || []) {
    if (Array.isArray(item.availableSells) && item.availableSells.length > 0) {
      return true;
    }
  }

  if (cell.isForum && Array.isArray(rev.buys) && rev.buys.length > 0) {
    const buySpec = rev.buys[0];
    const track = (gs.marketBoard && gs.marketBoard[buySpec.category]) || [];
    for (let colIdx = 0; colIdx < track.length; colIdx += 1) {
      const card = track[colIdx];
      if (!card) continue;
      const price = computeForumBuyPriceForCard(card, colIdx, buySpec.modifier || "=");
      if (Number(viewer.cash || 0) < price) continue;
      const isGuardTrack = card.track === "Guards" || buySpec.category === "Guards";
      const fits = doesItemFitWithoutSwap(viewer, {
        reqBlocks: isGuardTrack ? 0 : Math.max(1, Number(card.blocks) || 1),
        reqGuards: isGuardTrack ? Math.max(1, Number(card.guards) || 1) : 0,
        bonusBlocks: Number(card.bonusBlocks) || 0,
        bonusGuards: Number(card.bonusGuards) || 0,
      });
      const canSwap =
        fits ||
        (isGuardTrack
          ? Array.isArray(viewer.guards) && viewer.guards.length > 0
          : Array.isArray(viewer.cart) && viewer.cart.length > 0);
      if (canSwap) return true;
    }
  }

  if (rev.gamble && Number(viewer.cash || 0) > 0) {
    return true;
  }

  return false;
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
  const orderedPlayers = viewer
    ? [viewer, ...(gs.players || []).filter((p) => p.index !== viewer.index)]
    : [...(gs.players || [])];
  return el(
    "div",
    { className: "market-header-denarii-strip" },
    ...orderedPlayers.map((p) => {
      const swatchColor = resolveDieSwatchColor(p.color, "player");
      const isMe = Boolean(viewer && p.index === viewer.index);
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
        el(
          "span",
          {
            className: "denarii-pill-name",
            style: { color: swatchColor },
          },
          createPlayerNameNode(p, { iconSize: 16 }),
          isMe ? " (You):" : ":"
        ),
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
  const isMyMarketTurn = Boolean(viewer && gs.phase === "market" && gs.activePlayerIndex === viewer.index);
  const forumSpec = viewer ? getActiveForumBuySpec(gs, viewer) : null;

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
        const fitsInCart = viewer
          ? doesItemFitWithoutSwap(viewer, {
            reqBlocks,
            reqGuards,
            bonusBlocks: cardBonusBlocks,
            bonusGuards: cardBonusGuards,
          })
          : false;
        const canSwapToFit = viewer
          ? fitsInCart ||
          (isGuardTrack
            ? Array.isArray(viewer.guards) && viewer.guards.length > 0
            : Array.isArray(viewer.cart) && viewer.cart.length > 0)
          : false;

        const canMarketBuy = Boolean(viewer && isMyMarketTurn && viewer.cash >= basePrice && canSwapToFit);
        const canForumBuy = Boolean(
          viewer && isForumSellingTrack && forumSpec && forumSpec.canTransactNow && viewer.cash >= forumPrice && canSwapToFit
        );
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
        if (viewer && isForumSellingTrack && gs.phase === "delivery") {
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
        } else if (viewer && isMyMarketTurn && !fitsInCart && viewer.cash >= basePrice) {
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
              renderPhysicalMarketGoodCardFaceNode(card, {
                trackName,
                priceColIndex: col,
                isPriceIdxDirect: false,
                extraCardClass: canForumBuy ? "forum-buyable-card" : "",
                title: `Click to view ${card.name} up close`,
                onClick: () => {
                  if (isGuardTrack) {
                    openCartGuardDetailModal(Object.assign({ marketColIndex: col }, card));
                  } else {
                    openCartGoodDetailModal(
                      Object.assign({ track: trackName, marketColIndex: col }, card),
                      gs,
                      viewer,
                      true
                    );
                  }
                },
              }),
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
    { className: "market-board", id: "ostia-market-board" },
    el(
      "div",
      { className: "panel-title fresco-banner-header fresco-merchants", style: { flexWrap: "wrap", gap: "0.5rem" } },
      el("span", { text: "⚓ Portus Ostiae — Market Board" }),
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

const TIBER_UNBRIDGED_CELL_CLASSES = {};

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
  for (const m of (viewer && viewer.missions) || []) {
    if (!m.completed && !m.failed) {
      if (m.pickupCell && !m.pickedUp) missionCells.add(m.pickupCell);
      if (m.deliverCell) missionCells.add(m.deliverCell);
      if (m.cell) missionCells.add(m.cell);
    }
  }

  const scoutedTileByCoord = {};
  for (const si of (viewer && viewer.scoutedInfo) || []) {
    if (si && si.targetType === "tile" && si.targetKey && si.revealedData) {
      const bCell = gs.romeBoard && gs.romeBoard[si.targetKey];
      if (!bCell || !bCell.revealed) {
        scoutedTileByCoord[si.targetKey] = si.revealedData;
      }
    }
  }

  const isMyDeliveryTurn = Boolean(viewer && gs.phase === "delivery" && gs.activePlayerIndex === viewer.index);
  const reachableDirsByCell = {};
  const adjacentDirInfoByCell = {};
  let passableExitDir = null;
  let anyExitDir = null;
  const viewerPos = viewer ? viewer.position : null;
  const playerOffBoardDirs = viewerPos ? getCellOffBoardDirs(viewerPos) : [];
  const isPlayerOnPerimeter = playerOffBoardDirs.length > 0;
  const currCellObj = viewerPos ? gs.romeBoard[viewerPos] : null;
  const currOutDirs = (currCellObj && currCellObj.revealed && currCellObj.revealed.outgoingDirections) || {};
  for (const [dir, dInfo] of Object.entries(currOutDirs)) {
    if (dInfo && dInfo.targetCell) {
      adjacentDirInfoByCell[dInfo.targetCell] = { dir, ...dInfo };
    }
  }

  if (viewer && isMyDeliveryTurn && viewerPos && viewer.movesRemaining > 0) {
    for (const [dir, dInfo] of Object.entries(currOutDirs)) {
      if (dInfo.targetCell) {
        const riverBlocked = Boolean(dInfo.blockedByRiver) || isTiberCrossingBlocked(viewerPos, dInfo.targetCell);
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
    if (!viewer || !isMyDeliveryTurn || !viewerPos || viewer.movesRemaining <= 0 || !isPlayerOnPerimeter) {
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
      const isCurrent = Boolean(viewer && viewer.position === coord);
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
        if (adjInfo && viewer && viewer.position && viewer.position !== coord) {
          const compassBtn = document.querySelector(`.compass-btn[data-compass-dir="${adjInfo.dir}"]`);
          if (compassBtn) compassBtn.classList.add("is-hovered-dir");
        }
      };

      const exitEdgeVal = passableExitDir && rev && rev.edges ? rev.edges[passableExitDir] : null;
      const shortcutBypass = Boolean(viewer && viewer.turnEffects && viewer.turnEffects.shortcut);
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
        viewer &&
        isCurrent &&
        isMyDeliveryTurn &&
        viewer.movesRemaining > 0 &&
        passableExitDir &&
        !gs.pendingEncounter &&
        !hasPlayerBlockingPrompt(viewer, false, gs)
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

      gridCells.push(
        el(
          "div",
          {
            className: cellClasses.join(" "),
            "data-coord": coord,
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
    viewer && isMyDeliveryTurn && viewer.position && viewer.movesRemaining > 0 && isPlayerOnPerimeter && (passableExitDir || anyExitDir)
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
    ),
    renderRomeClockBoard(gs)
  );
}

const ROME_CLOCK_SLOTS = [
  { turn: 1, numeral: "I", label: "8:00 P.M." },
  { turn: 2, numeral: "II", label: "9:00 P.M." },
  { turn: 3, numeral: "III", label: "10:00 P.M." },
  { turn: 4, numeral: "IV", label: "11:00 P.M." },
  { turn: 5, numeral: "V", label: "12:00 A.M." },
  { turn: 6, numeral: "VI", label: "1:00 A.M." },
  { turn: 7, numeral: "VII", label: "2:00 A.M." },
  { turn: 8, numeral: "VIII", label: "3:00 A.M." },
  { turn: 9, numeral: "IX", label: "4:00 A.M." },
  { turn: 10, numeral: "X", label: "5:00 A.M." },
  { turn: 11, numeral: "DAWN", label: "6:00 A.M." },
];

function renderRomeClockBoard(gs) {
  const phase = (gs && gs.phase) || "market";
  const rawTurn = Math.max(1, Math.min(10, Number(gs && gs.turn) || 1));
  const activeSlotTurn =
    phase === "cleanup" || phase === "finished"
      ? 11
      : phase === "delivery" || phase === "delivery_entry"
        ? rawTurn
        : 1;
  const fineBase = gs && gs.season === "Fall" ? 32 : gs && gs.season === "Summer" ? 20 : 12;
  const fineGate = Math.floor(fineBase / 2);
  const seasonLabel = (gs && gs.season) || "Spring";
  const activeSlot = ROME_CLOCK_SLOTS.find((s) => s.turn === activeSlotTurn) || ROME_CLOCK_SLOTS[0];
  const isClockCollapsed = Boolean(appState.collapsedSections && appState.collapsedSections.clockBoard);

  if (isClockCollapsed) {
    const turnStr = `Turn ${activeSlot.numeral} - ${activeSlot.label}`;
    return el(
      "section",
      { className: "rome-clock-board-panel is-collapsed", id: "rome-clock-board" },
      el(
        "div",
        { className: "rome-clock-collapsed-row" },
        el(
          "div",
          {
            className: "rome-clock-collapsed-summary",
            text: `Clock: ${turnStr}   ${seasonLabel} Curfew: City: ${fineBase}, Gate: ${fineGate}`,
          }
        ),
        createSectionCollapseToggleBtn("clockBoard", true, "Expand Clock Board & Roll Charts")
      )
    );
  }

  const hourNodes = ROME_CLOCK_SLOTS.map((slot) => {
    const isActive = slot.turn === activeSlotTurn;
    const isDawn = slot.turn === 11;
    const isLateNight = slot.turn >= 6 && slot.turn <= 10;
    return el(
      "div",
      {
        className: `rome-clock-hour-slot ${isDawn ? "is-dawn" : ""} ${isLateNight ? "is-late-night" : ""} ${isActive ? "is-active" : ""
          }`.trim(),
        "data-clock-turn": String(slot.turn),
        title: isDawn
          ? `6:00 A.M. Dawn Curfew — Fine: ${fineBase}(d) in Rome, ${fineGate}(d) on a Gate`
          : `Turn ${slot.turn} (${slot.label})`,
      },
      el("div", { className: "rome-clock-numeral", text: slot.numeral }),
      el("div", { className: "rome-clock-hour-label", text: slot.label }),
      el(
        "div",
        { className: "rome-clock-token-well" },
        isActive
          ? el("span", {
            className: "rome-clock-token",
            id: "rome-clock-active-piece",
            title: "Current Night Hour Marker",
            text: "⏳",
          })
          : null
      )
    );
  });

  const keyItems = [
    {
      img: "/assets/icons/encounters/patricii_edge.png",
      title: "PATRICII",
    },
    {
      img: "/assets/icons/encounters/soothsayer_edge.png",
      title: "SOOTHSAYER",
    },
    {
      img: "/assets/icons/encounters/legiones_1_center.png",
      title: "LEGIONES",
    },
    {
      img: "/assets/icons/encounters/mob_edge.png",
      title: "ANGRY MOB",
    },
    {
      img: "/assets/icons/encounters/nefarii_1_center.png",
      title: "NEFARII",
    },
    {
      img: "/assets/icons/encounters/theater_corner_edge.png",
      title: "THEATER TROUPE",
    },
    {
      img: "/assets/icons/persist.png",
      title: "PERSISTENT",
      desc: "Stays revealed across seasons",
    },
    {
      img: "/assets/icons/refresh.png",
      title: "REFRESH",
      desc: "Discards & draws new tile",
    },
    {
      img: "/assets/icons/dice.png",
      title: "GAMBLING",
      desc: "Wager up to 20(d) as Transaction",
    },
    {
      tollText: "10(d)",
      title: "EDGE TOLL",
      desc: "Pay (d) to cross (Shortcut / Guard waives)",
    },
    {
      barClass: "edge-green",
      title: "GREEN BORDER",
      desc: "Open road (pass freely)",
    },
    {
      barClass: "edge-red",
      title: "RED BORDER",
      desc: "Blocked alley (Shortcut needed)",
    },
  ];

  const charts = [
    {
      title: "Theater Troupe (Roll 1®)",
      icon: "/assets/icons/encounters/theater_center.png",
      rows: [
        ["0", "Lose all Friendly Favor outcomes."],
        ["I", "Lose all Hostile Favor outcomes."],
        ["II", "Lose rest of this turn AND next turn (flip Cart)."],
        ["III", "Roll 1(R) and draw that many Influence cards."],
      ],
    },
    {
      title: "Angry Mob (Roll 1®)",
      icon: "/assets/icons/encounters/mob_center.png",
      rows: [
        ["0", "Takes all Wine on your Cart."],
        ["I", "Takes all Grain on your Cart."],
        ["II", "Takes your single most expensive Good."],
        ["III", "Clamors noisily (safe — no cargo lost)."],
      ],
    },
    {
      title: "Soothsayer Prophecy (Roll 1®)",
      icon: "/assets/icons/encounters/soothsayer_center.png",
      rows: [
        ["0–III", "Draw top Missiones card as a mandatory Soothsayer Mission."],
        ["Seal", "Seal rolled 1(R) Influence cards face-down beneath until completed."],
      ],
    },
    {
      title: "Driver Fate Chart (Roll 1®)",
      icon: "/assets/icons/combat.png",
      rows: [
        ["0", "Yep, dead. Lose all Goods; turn & night end."],
        ["I", "Left for dead. Lose all Goods; night continues."],
        ["II", "Beaten & mugged. Lose all Cash; night continues."],
        ["III", "Begged for mercy. Lose all Influence; night continues."],
      ],
    },
  ];

  const gambleChart = {
    title: "Stadium Gambling (Roll 1®)",
    icon: "/assets/icons/dice.png",
    rows: [
      ["Wager", "Up to 20(d) cash. Play Match Fixing (+1® total, up to 6×)."],
      ["0", "Lose wager to the bank."],
      ["I", "1× Wager (Break even)."],
      ["II", "2× Wager (Double Up)."],
      ["III", "3× Wager (Triple Up)."],
    ],
  };

  return el(
    "section",
    { className: "rome-clock-board-panel", id: "rome-clock-board" },
    el(
      "div",
      { className: "rome-clock-board-header" },
      el("div", { className: "rome-clock-board-title", text: "🕰️ Nocturnal Clock Board, Encounter Key & Roll Charts" }),
      el(
        "div",
        { className: "rome-clock-header-actions" },
        el("div", {
          className: "rome-clock-curfew-note",
          text: `${seasonLabel} Dawn Curfew: ${fineBase}(d) in City • ${fineGate}(d) on a Gate`,
        }),
        createSectionCollapseToggleBtn("clockBoard", false, "Collapse Clock Board")
      )
    ),
    el("div", { className: "rome-clock-hours-grid" }, ...hourNodes),
    el(
      "div",
      { className: "rome-clock-lower-grid" },
      el(
        "div",
        { className: "rome-clock-left-stack" },
        el(
          "div",
          { className: "rome-clock-subcard" },
          el("div", { className: "rome-clock-subcard-title", text: "🗝️ City Tile & Edge Encounter Key" }),
          el(
            "div",
            { className: "rome-clock-key-grid" },
            ...keyItems.map((k) =>
              el(
                "div",
                { className: "rome-clock-key-item" },
                el(
                  "div",
                  { className: "rome-clock-key-icon-box" },
                  k.tollText
                    ? el("span", { className: "dyn-edge-toll rome-clock-key-toll", text: k.tollText })
                    : k.barClass
                    ? el("span", { className: `rome-clock-key-bar ${k.barClass}`, "aria-label": k.title })
                    : el("img", { className: "rome-clock-key-icon", src: resolveAssetUrl(k.img), alt: k.title })
                ),
                el(
                  "div",
                  { className: "rome-clock-key-text" },
                  el("strong", { text: k.title }),
                  k.desc ? el("span", { text: k.desc }) : null
                )
              )
            )
          )
        ),
        el(
          "div",
          { className: "rome-clock-subcard rome-clock-gamble-subcard" },
          el(
            "div",
            { className: "rome-clock-subcard-title rome-clock-gamble-head" },
            el("img", {
              className: "rome-chart-box-icon",
              src: resolveAssetUrl(gambleChart.icon),
              alt: gambleChart.title,
            }),
            el("span", { text: gambleChart.title })
          ),
          el(
            "div",
            { className: "rome-chart-box" },
            ...gambleChart.rows.map(([dieLbl, desc]) =>
              el(
                "div",
                { className: "rome-chart-row" },
                el("span", { className: "rome-chart-die-pill", text: dieLbl }),
                el("span", { text: desc })
              )
            )
          )
        )
      ),
      el(
        "div",
        { className: "rome-clock-subcard" },
        el("div", { className: "rome-clock-subcard-title", text: "🎲 Encounter & Driver Fate Roll Charts" }),
        el(
          "div",
          { className: "rome-clock-charts-grid" },
          ...charts.map((ch) =>
            el(
              "div",
              { className: "rome-chart-box" },
              el(
                "div",
                { className: "rome-chart-box-head" },
                el("img", { className: "rome-chart-box-icon", src: resolveAssetUrl(ch.icon), alt: ch.title }),
                el("span", { text: ch.title })
              ),
              ...ch.rows.map(([dieLbl, desc]) =>
                el(
                  "div",
                  { className: "rome-chart-row" },
                  el("span", { className: "rome-chart-die-pill", text: dieLbl }),
                  el("span", { text: desc })
                )
              )
            )
          )
        )
      )
    )
  );
}

function renderCartNavigationWidget(gs, viewer) {
  const isCartInRome = Boolean(viewer && viewer.position);
  const navCoord = (viewer && viewer.position) || "B1";
  const cell = gs.romeBoard[navCoord] || gs.romeBoard["B1"];
  const rev = isCartInRome && cell ? cell.revealed : null;
  const isMyDeliveryTurn = Boolean(viewer && hasViewerEnteredRomeForDelivery(gs, viewer) && gs.activePlayerIndex === viewer.index);
  const isMyGateEntryTurn = Boolean(viewer && gs.phase === "delivery_entry" && gs.activePlayerIndex === viewer.index);
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
    const shortcutActive = Boolean(viewer && viewer.turnEffects && viewer.turnEffects.shortcut);
    const passable = !riverBlocked && (info.passable || shortcutActive);
    const canClickMove = Boolean(viewer && isMyDeliveryTurn && viewer.movesRemaining > 0 && passable);
    const destLabel = info.isExit ? "🚪 EXIT ROME" : `→ ${info.targetCell}`;
    const subLabel = riverBlocked
      ? "🌊 Tiber River"
      : bridgeName
      ? `🌉 ${bridgeName} • ${formatEdgeLabel(info.edge)}`
      : formatEdgeLabel(info.edge);
    return el(
      "button",
      {
        type: "button",
        className: `compass-btn ${passable ? "passable" : "blocked"}`,
        "data-compass-dir": dir,
        disabled: !canClickMove,
        title: `Move ${dir} (${destLabel})`,
        onClick: () => sendGameAction({ type: "delivery_move", direction: dir }),
      },
      el("strong", { text: `${dir} (${destLabel})` }),
      el("span", { style: { fontSize: "0.66rem" }, text: subLabel })
    );
  });

  const locationStatusText = !viewer
    ? "👁️ Spectating Rome"
    : isCartInRome
    ? `📍 Cart at ${viewer.position} — ${cell ? cell.name : ""}`
    : viewer.exitedRome
    ? "✓ Cart Exited Rome Safely"
    : isMyGateEntryTurn
    ? "🚪 At City Gates — Choose Entry Gate"
    : "⚓ Cart at Portus Ostiae";

  const movesStatusText = !viewer
    ? "Read-Only"
    : isCartInRome
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
  if (viewer && isMyDeliveryTurn && rev) {
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
          color: viewer && isMyDeliveryTurn && viewer.movesRemaining > 0 ? "#15803d" : "var(--text-muted)",
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
                "data-gate-coord": gCoord,
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
            id: "tx-actions-box",
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

function confirmRemovePlayerToIonicBot(gs, targetPlayer, isSelf) {
  if (!gs || !targetPlayer || !appState.currentGameId) return;
  const titleText = isSelf
    ? "👁️ Leave Seat & Spectate Match (Ionic AI Takeover)"
    : `🤖 Replace ${targetPlayer.name} with Ionic AI`;
  const msgText = isSelf
    ? `Step down from "${targetPlayer.name}" and watch as a Spectator? An Ionic (Medium) AI bot will take over your seat, keeping your Cart, Denarii, Favor, Missions, and position intact.`
    : `Replace "${targetPlayer.name}" with an Ionic (Medium) AI bot? Their current Cart, Denarii, Favor, Missions, and position will be preserved under AI control.`;

  const body = el(
    "div",
    { className: "modal-card" },
    el("p", { style: { marginTop: 0, lineHeight: "1.45" }, text: msgText }),
    gs.speedMode === "fast"
      ? el("p", {
        style: { fontSize: "0.82rem", color: "var(--text-muted)" },
        text: `⚡ Fast Game: This match advances bots automatically after ${gs.turnTimeLimitMinutes || 6} min inactivity timeouts; if no human seats remain, step-by-step AI playback activates for you.`,
      })
      : null,
    el(
      "div",
      { style: { display: "flex", gap: "0.6rem", justifyContent: "flex-end", marginTop: "1rem" } },
      el("button", { type: "button", className: "btn", text: "Cancel", onClick: closeModal }),
      el("button", {
        type: "button",
        className: "btn btn-crimson",
        text: isSelf ? "👁️ Spectate (Ionic AI Takeover)" : "🤖 Replace with Ionic AI",
        onClick: async () => {
          try {
            const res = await apiRequest(`/api/games/${appState.currentGameId}/remove-player`, "POST", {
              playerIndex: targetPlayer.index,
            });
            closeModal();
            if (res && res.summary) appState.gameSummary = res.summary;
            if (res && res.state) {
              appState.gameState = res.state;
              if (res.state.isSpectator) {
                appState.spectatorAutoPlay = false;
              }
            }
            appState._lastTabletopPollJson = buildTabletopSnapshotKey(res);
            showToast(res.message || `${targetPlayer.name} is now controlled by an Ionic AI bot.`);
            renderApp();
          } catch (err) {
            showToast(err.message || "Could not replace player with Ionic AI.", true);
          }
        },
      })
    )
  );
  showModal(titleText, body);
}

function renderPlayerSidebar(gs, viewer) {
  const isNavTab = appState.cartPanelTab === "navigate";
  const canSteerNow = Boolean(
    viewer &&
    gs.activePlayerIndex === viewer.index &&
    ((gs.phase === "delivery" && Boolean(viewer.position) && (viewer.movesRemaining || 0) > 0) ||
      gs.phase === "delivery_entry")
  );
  const viewerMissionsDone = viewer ? Number(viewer.missionsCompleted) || 0 : 0;
  const viewerMissionsFail = viewer ? Number(viewer.missionsFailed) || 0 : 0;
  const viewerNetMissions = viewer
    ? typeof viewer.netMissions === "number"
      ? viewer.netMissions
      : viewerMissionsDone - viewerMissionsFail
    : 0;

  const summary = appState.gameSummary || {};
  const currentUserId = appState.user && appState.user.id;
  const isAdminUser = Boolean(appState.user && appState.user.isAdmin);
  const isGameCreator = Boolean(currentUserId && summary.hostUserId && currentUserId === summary.hostUserId);
  const canManageHumanPlayers = Boolean((isGameCreator || isAdminUser) && gs.phase !== "finished");
  const canChatInGame = Boolean(appState.user && gs && (viewer || isGameCreator || isAdminUser));
  const isMerchantsCollapsed = Boolean(appState.collapsedSections && appState.collapsedSections.merchantsInRome);
  const isFavorCollapsed = Boolean(appState.collapsedSections && appState.collapsedSections.factionStandings);
  const focusFavorPlayer =
    viewer || (gs.players && gs.players[gs.activePlayerIndex]) || (gs.players && gs.players[0]) || null;

  return el(
    "div",
    { className: "sidebar-stack" },
    // All Players Summary
    isMerchantsCollapsed
      ? el(
          "div",
          { className: "panel merchants-panel is-collapsed", id: "merchants-rome-panel" },
          el(
            "div",
            { className: "merchants-collapsed-row" },
            el("span", { className: "merchants-collapsed-label", text: "Merchants:" }),
            el(
              "div",
              { className: "merchants-collapsed-strip" },
              ...(gs.players || []).map((p) => {
                const cashColor = p.eliminated ? "#b91c1c" : resolveDieSymbolColor(p.color, "player");
                const dotColor = resolveDieSwatchColor(p.color, "player");
                const shortName = getAbbrevMerchantName(p);
                const isActiveTurn = p.index === gs.activePlayerIndex;
                return el(
                  "button",
                  {
                    type: "button",
                    className: `merchant-collapsed-chip ${isActiveTurn ? "is-active-turn" : ""} ${p.eliminated ? "is-eliminated" : ""}`,
                    style: { borderBottomColor: dotColor },
                    title: `${p.name}: ${p.cash}(d) (Click to inspect Cart)`,
                    onClick: () => openPlayerCartModal(gs, p, viewer),
                  },
                  el("span", { className: "merchant-collapsed-dot", style: { background: dotColor } }),
                  el("span", { className: "merchant-collapsed-name", text: shortName }),
                  el("span", {
                    className: "merchant-collapsed-cash",
                    style: { color: cashColor },
                    text: `${p.cash}d`,
                  })
                );
              })
            ),
            createSectionCollapseToggleBtn("merchantsInRome", true, "Expand Merchants in Rome")
          )
        )
      : el(
          "div",
          { className: "panel merchants-panel", id: "merchants-rome-panel" },
          el(
            "h3",
            { className: "panel-title" },
            el("span", { text: "👥 Merchants in Rome" }),
            el(
              "div",
              { className: "panel-title-right-group" },
              el("span", { style: { fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: "600" }, text: "Click to inspect Cart" }),
              createSectionCollapseToggleBtn("merchantsInRome", false, "Collapse Merchants in Rome")
            )
          ),
          el(
            "div",
            { className: "players-strip" },
            ...gs.players.map((p) => {
              const swatchColor = resolveDieSwatchColor(p.color, "player");
              const pDone = Number(p.missionsCompleted) || 0;
              const pFail = Number(p.missionsFailed) || 0;
              const pNet = typeof p.netMissions === "number" ? p.netMissions : pDone - pFail;
              const isSelfSeat = Boolean(viewer && p.index === viewer.index);
              const showReplaceBtn = canManageHumanPlayers && !p.isBot;
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
                  { style: { display: "flex", alignItems: "center", gap: "0.35rem", fontWeight: "700", flexWrap: "wrap" } },
                  renderCartIconNode(p.color, "", `${p.name}'s Cart`),
                  p.eliminated ? el("span", { text: "☠️ " }) : null,
                  createPlayerNameNode(p, { iconSize: 16 })
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
                }),
                showReplaceBtn
                  ? el(
                    "div",
                    { style: { marginTop: "0.32rem" } },
                    el("button", {
                      type: "button",
                      className: "btn btn-xs btn-crimson",
                      style: { width: "100%", fontSize: "0.68rem", padding: "0.18rem 0.35rem" },
                      title: isSelfSeat
                        ? "Leave this seat and enter Spectator Mode (an Ionic AI bot takes over)"
                        : `Replace ${p.name} with an Ionic AI bot`,
                      text: isSelfSeat ? "👁️ Spectate (Ionic AI)" : "🤖 → Ionic AI",
                      onClick: (e) => {
                        e.stopPropagation();
                        confirmRemovePlayerToIonicBot(gs, p, isSelfSeat);
                      },
                    })
                  )
                  : null
              );
            })
          )
        ),

    // Imperial Faction Standings (Directly under Merchants in Rome, above Cart Holdings)
    isFavorCollapsed
      ? el(
          "div",
          { className: "panel faction-standings-panel is-collapsed", id: "faction-standings-panel" },
          el(
            "div",
            { className: "favor-collapsed-row" },
            el("span", { className: "favor-collapsed-label", text: "Favor:" }),
            el(
              "div",
              { className: "favor-collapsed-strip" },
              ...FACTION_META.map((fm) => {
                const val =
                  focusFavorPlayer && focusFavorPlayer.favor ? Number(focusFavorPlayer.favor[fm.key]) || 0 : 0;
                const valText = val > 0 ? `+${val}` : String(val);
                return el(
                  "button",
                  {
                    type: "button",
                    className: "favor-collapsed-gem-chip",
                    title: `${fm.key}: ${valText} Favor (Click for Details)`,
                    onClick: () => {
                      if (focusFavorPlayer) openFactionFavorModal(gs, focusFavorPlayer, fm.key);
                    },
                  },
                  el("img", { className: "favor-collapsed-gem-img", src: fm.gem, alt: fm.key }),
                  el("span", {
                    className: `favor-collapsed-gem-val ${val > 0 ? "pos" : val < 0 ? "neg" : "zero"}`,
                    text: valText,
                  })
                );
              })
            ),
            createSectionCollapseToggleBtn("factionStandings", true, "Expand Faction Standings")
          )
        )
      : el(
          "div",
          { className: "panel faction-standings-panel", id: "faction-standings-panel" },
          el(
            "h3",
            { className: "panel-title" },
            el("span", { text: "🏛️ Faction Standings" }),
            el(
              "div",
              { className: "panel-title-right-group" },
              el("span", {
                style: { fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: "600" },
                text: "Click a Gem for Details",
              }),
              createSectionCollapseToggleBtn("factionStandings", false, "Collapse Faction Standings")
            )
          ),
          viewer
            ? el(
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
                        const fullName = String(rv.name || "Rival").trim() || "Rival";
                        return el(
                          "div",
                          {
                            className: "faction-standing-rival-line",
                            title: `${fullName}: ${rVal > 0 ? `+${rVal}` : rVal} ${fm.key}`,
                          },
                          el(
                            "span",
                            { className: "faction-standing-rival-name" },
                            el("span", {
                              className: "faction-standing-swatch",
                              style: { background: resolveDieSwatchColor(rv.color, "player") },
                            }),
                            el("span", {
                              className: "faction-standing-rival-label",
                              "data-full-name": fullName,
                              text: fullName,
                            })
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
            )
            : el(
              "div",
              { className: "favor-row", style: { margin: "0" } },
              ...FACTION_META.map((fm) =>
                el(
                  "div",
                  {
                    className: "favor-box clickable-favor-box",
                    style: { cursor: "pointer" },
                    title: `Click to view ${fm.key} Favor alignments & deck counts`,
                    onClick: () => {
                      if (gs.players && gs.players[0]) openFactionFavorModal(gs, gs.players[0], fm.key);
                    },
                  },
                  el("img", { className: "favor-gem-img", src: fm.gem, alt: fm.key }),
                  el("div", { style: { fontWeight: "700", color: fm.color }, text: fm.key }),
                  el(
                    "div",
                    { className: "faction-standings-rivals", style: { marginTop: "0.3rem" } },
                    ...(gs.players || []).map((rv) => {
                      const rVal = (rv.favor && rv.favor[fm.key]) || 0;
                      const fullName = String(rv.name || "Merchant").trim() || "Merchant";
                      return el(
                        "div",
                        {
                          className: "faction-standing-rival-line",
                          style: { cursor: "pointer" },
                          title: `View ${fullName}'s ${fm.key} Favor details`,
                          onClick: (e) => {
                            e.stopPropagation();
                            openFactionFavorModal(gs, rv, fm.key);
                          },
                        },
                        el(
                          "span",
                          { className: "faction-standing-rival-name" },
                          el("span", {
                            className: "faction-standing-swatch",
                            style: { background: resolveDieSwatchColor(rv.color, "player") },
                          }),
                          el("span", {
                            className: "faction-standing-rival-label",
                            "data-full-name": fullName,
                            text: fullName,
                          })
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
                )
              )
            ),
          viewer ? renderDomnaMediatorExchangeBar(gs, viewer, false) : null
        ),

    ...(viewer
      ? [
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
      const allSoothOverflow = areAllMissionsSoothsayer(allMissions);
      const canCancelSoothsayer = canActivelyCancel && allSoothOverflow;
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
          sub: canCancelSoothsayer
            ? "Cancel 1 Free"
            : allMissions.length > MAX_ACTIVE_MISSIONS
            ? "🔒 Locked (Not All 6 Soothsayer)"
            : bondedCouriersActive
            ? "🔒 2× Cash / -10d"
            : "🔒 Mandatory",
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
                  allSoothsayerOverflow: allSoothOverflow,
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
            { text: `📜 Active Missions (${allMissions.length}/${MAX_ACTIVE_MISSIONS})${bondedCouriersActive ? " [2× Cash / -10d Fail]" : ""}` }
          ),
          allMissions.length > MAX_ACTIVE_MISSIONS
            ? el("button", {
                type: "button",
                className: "btn btn-sm",
                style: {
                  fontSize: "0.72rem",
                  background: "#b45309",
                  color: "#fff",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  fontWeight: "700",
                  border: "1px solid #92400e",
                },
                text: allSoothOverflow
                  ? `⚠️ ${allMissions.length}/5 Soothsayer Missions — Cancel 1 Free`
                  : `⚠️ ${allMissions.length}/5 Active Missions — Cancel 1 Now`,
                onClick: () => openPendingMissionOverflowModal(gs, viewer),
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
              const cName = String(c.name || "");
              const pend = gs.pendingEncounter;
              const playInfo = getInfluenceCardPlayability(gs, viewer, c);

              let actionNode = null;
              if (
                gs.phase !== "setup_discard" &&
                gs.phase !== "setup_climate" &&
                gs.phase !== "finished"
              ) {
                if (playInfo.playable) {
                  const singleRerollSidebar =
                    cName === "Twist Of Fate" && pend && getEligibleRerollTargets(pend).length === 1;
                  const needsThugSwap =
                    cName.includes("Thug") && !doesItemFitWithoutSwap(viewer, { reqGuards: 1 });
                  const needsWineForgerSwap =
                    cName.includes("Wine Forger") && !doesItemFitWithoutSwap(viewer, { reqBlocks: 1 });
                  const isArmedCard = Boolean(appState.armedDieAction && appState.armedDieAction.cardId === c.id);
                  const isCombatSideCard =
                    cName === "Mercenary Ambush" ||
                    cName === "Distraction" ||
                    cName === "Gladiator's Intervention" ||
                    cName === "Flying Chamber Pot";
                  if (isCombatSideCard && pend) {
                    const encP =
                      (gs.players || []).find((p) => p.index === pend.playerIndex) ||
                      (gs.players && gs.players[pend.playerIndex]) ||
                      viewer;
                    const oppNm = (pend.card && pend.card.name) || "Opponent";
                    const isOtherEnc = encP.index !== viewer.index;
                    actionNode = buildCombatInfluenceCardActionNode(
                      c,
                      encP.name,
                      oppNm,
                      isOtherEnc
                    );
                  } else {
                    actionNode = el("button", {
                      className: `btn btn-sm ${isArmedCard ? "btn-crimson" : "btn-primary"}`,
                      style: { width: "100%", fontSize: "0.72rem", padding: "0.28rem 0.5rem" },
                      text:
                        playInfo.mode === "casus_belli"
                          ? "⚔️ Play Casus Belli"
                          : playInfo.mode === "top3"
                          ? "👁️ Inspect & Reorder Top 3"
                          : playInfo.mode === "procurer"
                          ? "🛒 Choose Good @ Common (>)"
                          : playInfo.mode === "prophecy"
                          ? "🔮 Summon Soothsayer..."
                          : playInfo.mode === "shortcut"
                          ? "🛣️ Ready Shortcut for Move"
                          : playInfo.mode === "twist" || playInfo.mode === "lucky_break"
                          ? singleRerollSidebar
                            ? "🎲 Re-Roll Die"
                            : isArmedCard
                            ? "👆 Click Any Die to Apply"
                            : "🎲 Click a Die to Apply"
                          : needsThugSwap
                          ? "▶ Play Card (Fire Guard)"
                          : needsWineForgerSwap
                          ? "▶ Play Card (Swap Good)"
                          : "▶ Play Card",
                      onClick: (e) => {
                        e.stopPropagation();
                        if (playInfo.mode === "top3") {
                          openInformantsTargetModal(gs, viewer, c);
                        } else if (playInfo.mode === "procurer") {
                          openProcurerGoodModal(gs, viewer, c);
                        } else if (playInfo.mode === "prophecy") {
                          openProphecyTargetModal(gs, viewer, c);
                        } else {
                          triggerInfluenceCardPlay(gs, viewer, c);
                        }
                      },
                    });
                  }
                } else if (
                  playInfo.mode === "casus_belli" &&
                  !pend &&
                  gs.phase === "delivery" &&
                  gs.activePlayerIndex === viewer.index
                ) {
                  actionNode = el("button", {
                    className: "btn btn-sm btn-primary",
                    style: { width: "100%", fontSize: "0.72rem", padding: "0.28rem 0.5rem" },
                    disabled: true,
                    title: playInfo.disabledReason || undefined,
                    text: "⚔️ Play Casus Belli",
                  });
                } else if (playInfo.badgeText) {
                  const isActivePositive = Boolean(playInfo.badgePositive);
                  actionNode = el("div", {
                    style: {
                      fontSize: "0.68rem",
                      color: isActivePositive ? "#14532d" : "#92400e",
                      textAlign: "center",
                      padding: "0.24rem 0.4rem",
                      background: isActivePositive ? "#ecfdf5" : "#fef3c7",
                      border: isActivePositive ? "1px solid #16a34a" : "1px solid #d97706",
                      borderRadius: "5px",
                      fontWeight: "700",
                    },
                    title: playInfo.disabledReason || undefined,
                    text: playInfo.badgeText,
                  });
                }
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
      ]
      : [
        el(
          "div",
          { className: "panel spectator-sidebar-card" },
          el("h3", { className: "panel-title", text: "👁️ Spectator Mode — Public Overview" }),
          el("p", {
            style: { fontSize: "0.8rem", color: "var(--text-muted)", margin: "0.25rem 0 0" },
            text: "You are observing with public tabletop visibility. Click any Merchant card or Faction gem above to inspect public Carts and Favor; hidden player Influence hands, Missions, and Scouted Secrets stay concealed.",
          })
        ),
      ]),

    // Chronicle Game Log & Player Chat
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
            const box = e.currentTarget;
            const distFromBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
            appState.chronicleScrollTop = box.scrollTop;
            appState.chronicleUserScrolled = distFromBottom > 12;
          },
        },
        ...(gs.logs || []).map((lg) => {
          if (lg && lg.category === "chat") {
            return el(
              "div",
              { className: "log-entry cat-chat" },
              el("span", { className: "log-chat-prefix", text: `[${lg.season || "Spring"} T${lg.turn || 1}] ` }),
              el("strong", {
                className: "log-chat-sender",
                style: { color: getChronicleSenderColor(lg.senderColor) },
                text: `${lg.senderName || "Merchant"}${lg.isSpectator ? " (Spectator)" : ""}: `,
              }),
              el("span", { className: "log-chat-text", text: String(lg.text || "") })
            );
          }
          return el("div", {
            className: `log-entry cat-${(lg && lg.category) || "info"}`,
            text: `[${(lg && lg.season) || "Spring"} T${(lg && lg.turn) || 1}] ${(lg && lg.text) || ""}`,
          });
        })
      ),
      canChatInGame
        ? el(
          "form",
          {
            id: "chronicle-chat-form",
            className: "chronicle-chat-form",
            onSubmit: (e) => {
              e.preventDefault();
              sendChronicleChatMessage();
            },
          },
          el("input", {
            id: "chronicle-chat-input",
            type: "text",
            className: "form-input chronicle-chat-input",
            maxLength: 300,
            autocomplete: "off",
            placeholder: viewer ? "Send message to Rome..." : "Send Spectator message...",
            value: appState.chronicleDraftText || "",
            onInput: (e) => {
              appState.chronicleDraftText = e.target.value;
            },
          }),
          el("button", {
            type: "submit",
            className: "btn btn-sm btn-primary chronicle-chat-send-btn",
            text: "Send",
          })
          )
        : null
    )
  );
}

/* =========================================================================
   MODALS FOR SOURCING, SCOUTING, CARGO LOADING, TRASHING, FORUM BUY, & GAMBLING
   ========================================================================= */

/**
 * Displays the Tile Detail popup with board card preview, neighborhood metadata,
 * unused turn action indicators, and direct Move / Scout / Scout Deck Card / End Turn controls.
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

  const resolvedMoveOpts = moveOpts || computeTileMoveOptsForTarget(gs, viewer, coord);
  let crossingNote = "";
  const adjInfo = (resolvedMoveOpts && resolvedMoveOpts.adjInfo) || null;
  if (adjInfo && viewer && viewer.position && viewer.position !== coord) {
    const dir = adjInfo.dir || resolvedMoveOpts.moveDir || "";
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

  const isEntryPhase = Boolean(gs && gs.phase === "delivery_entry");
  const isDeliveryPhase = Boolean(gs && gs.phase === "delivery");
  const isMyTurn = Boolean(
    gs &&
      viewer &&
      gs.activePlayerIndex === viewer.index &&
      (isEntryPhase || isDeliveryPhase) &&
      !viewer.exitedRome &&
      !viewer.nightEnded
  );
  const tileModalPromptBlocked = Boolean(gs && (gs.pendingEncounter || hasPlayerBlockingPrompt(viewer, true, gs)));
  const tileModalMissionOverflow = Boolean(gs && hasMissionOverflow(viewer, gs));
  const isGateCell = Boolean(cell && cell.isGate);
  const isGateEntrance = Boolean(isEntryPhase && isGateCell && isMyTurn && !tileModalPromptBlocked);
  const canScoutTile = Boolean(isMyTurn && !viewer.scoutedThisTurn && unrevealedCount > 0 && !tileModalPromptBlocked);
  const canScoutDeck = Boolean(isMyTurn && !viewer.scoutedThisTurn && !tileModalPromptBlocked);
  const canTrashThisTile = Boolean(
    !isEntryPhase &&
      isDeliveryPhase &&
      isMyTurn &&
      !viewer.trashedThisTurn &&
      !tileModalPromptBlocked &&
      Array.isArray(viewer.influence) &&
      viewer.influence.length > 0 &&
      (exposedTile || unrevealedCount > 0)
  );
  const centerEncounterKey =
    rev && rev.encounter && ["patricii", "legiones", "nefarii"].includes(String(rev.encounter).toLowerCase())
      ? String(rev.encounter).toLowerCase()
      : null;
  const moveDir =
    resolvedMoveOpts && resolvedMoveOpts.moveDir ? String(resolvedMoveOpts.moveDir) : null;
  const canMoveStep = Boolean(
    !isEntryPhase &&
      isDeliveryPhase &&
      isMyTurn &&
      moveDir &&
      Number(viewer.movesRemaining || 0) > 0 &&
      !tileModalPromptBlocked
  );
  const canMoveHere = Boolean(canMoveStep || isGateEntrance);
  const canEndTurnHere = Boolean(!isEntryPhase && isDeliveryPhase && isMyTurn && !tileModalPromptBlocked);

  const showGateEntryEndTurn = Boolean(isEntryPhase);
  const hasEnteredRome = hasViewerEnteredRomeForDelivery(gs, viewer);
  const showTurnActionCounters = Boolean(
    isMyTurn && isDeliveryPhase && !isEntryPhase && hasEnteredRome
  );
  const unusedMoves = showTurnActionCounters
    ? Math.max(0, Number(viewer.movesRemaining || 0))
    : 0;
  const unusedTransactions =
    showTurnActionCounters && hasAvailableDeliveryTransactionNow(gs, viewer)
      ? 1
      : 0;

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

  const moveBtnLabel = isGateEntrance
    ? `🚪 Move to ${cellName}`
    : moveDir
    ? `🛒 Move to ${cellName} (${moveDir})`
    : `🛒 Move to ${cellName}`;

  showModal(
    `${isGateEntrance ? "🚪" : "🔍"} Tile ${coord} — ${cellName}`,
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
            el(
              "span",
              { style: { marginLeft: "0.3rem" } },
              createPlayerNameNode(p, { iconSize: 16 }),
              viewer && p.index === viewer.index ? " (Your Cart)" : null
            )
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
            rev.id
              ? el("div", {}, el("strong", { style: { color: "var(--gold-bright)" }, text: "Tile ID: " }), rev.id)
              : null,
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
              text: replaceDenariiTokens(crossingNote),
            })
          : null,
        ROME_NEIGHBORHOOD_HISTORIES[coord]
          ? el("div", {
            className: "tile-history-blurb",
            text: ROME_NEIGHBORHOOD_HISTORIES[coord],
          })
          : null
      ),
      renderTileStackWatermarkSection(coord, cell),
      el(
        "div",
        {
          style: {
            width: "100%",
            display: "flex",
            gap: "0.85rem",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "flex-end",
            paddingTop: "0.65rem",
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
              ? `Move your Cart to ${coord} (${cellName})`
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
                ? `Scout the top unrevealed tile of ${coord} (${cellName}) before entering Rome`
                : `Free once-per-turn Scout: peek at the top unrevealed tile of ${coord} (${cellName}) without ending your turn`
              : "Scout Tile is unavailable (already scouted, no unrevealed tiles, or not your turn)",
            text: `👁️ Scout ${cellName}`,
            onClick: () => {
              if (!canScoutTile) return;
              executeTileScoutAction(gs, viewer, coord);
            },
          }),
          el("button", {
            id: "modal-scout-deck-btn",
            type: "button",
            className: "btn",
            disabled: !canScoutDeck,
            title: canScoutDeck
              ? "Free once-per-turn Scout: peek at the top card of any of the 6 decks without ending your turn"
              : "Scout Deck Card is unavailable (already scouted or not your turn)",
            text: "🃏 Scout Deck Card",
            onClick: () => {
              if (!canScoutDeck) return;
              closeModal();
              openScoutModal(gs, viewer);
            },
          }),
          !isEntryPhase && isDeliveryPhase
            ? el("button", {
                id: "modal-trash-tile-btn",
                type: "button",
                className: "btn",
                disabled: !canTrashThisTile,
                title: canTrashThisTile
                  ? `Discard 1 Influence card to trash ${
                      exposedTile
                        ? `the exposed face-up tile (${occupants.length > 0 ? "occupied: flips replacement" : "unoccupied: leaves unrevealed"}) or `
                        : ""
                    }the top unrevealed stack tile of ${coord}`
                  : "Trash Tile is unavailable (already trashed this turn, no Influence cards, or not your turn)",
                text: exposedTile ? "🗑️ Trash Tile" : "🗑️ Bury Stack Tile",
                onClick: () => {
                  if (!canTrashThisTile) return;
                  closeModal();
                  openTrashModal(gs, viewer, {
                    cell: coord,
                    targetMode: exposedTile ? "revealed" : "stack",
                  });
                },
              })
            : null,
          el("button", {
            id: "modal-encounter-decks-btn",
            type: "button",
            className: "btn",
            title: "Inspect Patricii, Legiones, and Nefarii encounter deck mechanics, Roman history, and live faction card counts",
            text: centerEncounterKey
              ? `🃏 ${ENCOUNTER_DECK_PROFILES[centerEncounterKey].label} Odds`
              : "🃏 Encounter Decks",
            onClick: () => openEncounterDecksOverviewModal(gs, centerEncounterKey),
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
          !showGateEntryEndTurn && showTurnActionCounters && unusedIndicatorItems.length > 0
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
          showGateEntryEndTurn
            ? el("button", {
                id: "modal-end-turn-btn",
                type: "button",
                className: "btn btn-crimson btn-end-turn-gate-entry",
                disabled: true,
                title: "End Turn is unavailable during Dusk Gate Entry — select a Via Gate entrance to enter Rome",
                text: "⏭️ End Turn",
              })
            : el("button", {
                id: "modal-end-turn-btn",
                type: "button",
                className: "btn btn-crimson",
                disabled: !canEndTurnHere,
                title: tileModalMissionOverflow
                  ? "End Turn is unavailable while holding more than 5 active missions — cancel 1 mission first"
                  : tileModalPromptBlocked
                  ? "End Turn is unavailable until you resolve your active prompt"
                  : canEndTurnHere
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
            renderGoodPriceTableNode(
              c,
              trackName,
              typeof cand.colIndex === "number" ? cand.colIndex : -1,
              typeof cand.colIndex !== "number"
            )
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
            renderGoodPriceTableNode(
              c,
              trackName,
              typeof cand.colIndex === "number" ? cand.colIndex : -1,
              typeof cand.colIndex !== "number"
            )
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
          renderGoodPriceTableNode(card, trackName, -1, true)
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
  const viewer = getViewerPlayer(gs);
  const scoutedCoord =
    si.targetType === "tile" && si.targetKey ? String(si.targetKey).trim().toUpperCase() : null;
  const scoutedCell = scoutedCoord && gs && gs.romeBoard ? gs.romeBoard[scoutedCoord] : null;
  const scoutedCellName = (scoutedCell && scoutedCell.name) || scoutedCoord;
  const canMoveToScoutedGate = Boolean(
    gs &&
      viewer &&
      si.targetType === "tile" &&
      scoutedCell &&
      scoutedCell.isGate &&
      gs.phase === "delivery_entry" &&
      gs.activePlayerIndex === viewer.index &&
      !viewer.position &&
      !viewer.exitedRome &&
      !viewer.nightEnded &&
      !gs.pendingEncounter
  );
  const canEndTurnFromScout =
    Boolean(gs) &&
    typeof gs.viewerPlayerIndex === "number" &&
    gs.phase === "delivery" &&
    gs.activePlayerIndex === gs.viewerPlayerIndex &&
    !gs.pendingEncounter &&
    !hasPlayerBlockingPrompt(getViewerPlayer(gs), true, gs);
  const scoutViewer =
    canEndTurnFromScout && Array.isArray(gs.players)
      ? gs.players[gs.viewerPlayerIndex]
      : null;
  const hasMoreActionsAfterScout = Boolean(
    scoutViewer &&
      (Number(scoutViewer.movesRemaining || 0) > 0 || hasAvailableDeliveryTransactionNow(gs, scoutViewer))
  );

  showModal(
    `👁️ Scouted Intelligence — ${si.label || "Revealed Secret"}`,
    el(
      "div",
      {},
      visualNode,
      el(
        "div",
        { style: { display: "flex", gap: "0.6rem", justifyContent: "flex-end", marginTop: "1rem", flexWrap: "wrap" } },
        canMoveToScoutedGate
          ? el("button", {
              id: "scout-modal-move-to-btn",
              type: "button",
              className: "btn btn-primary",
              title: `Enter Rome through ${scoutedCoord} (${scoutedCellName})`,
              text: `🚪 Move to ${scoutedCellName}`,
              onClick: () => {
                closeModal();
                sendGameAction({ type: "select_gate", gate: scoutedCoord });
              },
            })
          : null,
        el("button", {
          id: "scout-modal-close-btn",
          type: "button",
          className:
            (!canEndTurnFromScout && !canMoveToScoutedGate) || (canEndTurnFromScout && hasMoreActionsAfterScout)
              ? "btn btn-primary"
              : "btn",
          text: "Close Scout View",
          onClick: closeModal,
        }),
        canEndTurnFromScout
          ? el("button", {
              type: "button",
              className: hasMoreActionsAfterScout ? "btn" : "btn btn-primary",
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

function openCancelMissionConfirmModal(m, allSoothsayerOrCount = false) {
  const src = m.source || "starting";
  const vp = appState.gameState ? getViewerPlayer(appState.gameState) : null;
  const allowSoothsayer = vp
    ? areAllMissionsSoothsayer(vp.missions)
    : typeof allSoothsayerOrCount === "boolean"
    ? allSoothsayerOrCount
    : Number(allSoothsayerOrCount || 0) > MAX_ACTIVE_MISSIONS;
  if (src === "soothsayer" && !allowSoothsayer) {
    showToast("A Soothsayer mission can only be canceled if all six (6) active missions are Soothsayer missions!", true);
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
    ruleExplanation = "Because all 6 of your active missions are Soothsayer missions, you may cancel one Soothsayer mission with no penalty (its sealed Influence cards return to the deck).";
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
  if (cName.includes("Match Fixing") || String(card.effectCode || "") === "match_fixing") {
    showToast("🏟️ Match Fixing can only be played inside the Stadium Gambling modal.", "error");
    return;
  }
  const playInfo = getInfluenceCardPlayability(gs, viewer, card);
  if (playInfo && !playInfo.playable && playInfo.disabledReason) {
    showToast(playInfo.disabledReason, true);
    return;
  }
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

  if (cName === "Twist Of Fate") {
    triggerTwistOfFateOrArm(gs, card);
    return;
  }

  if (cName === "Lucky Break") {
    armDieCardAction(card, "plus_one");
    showToast(`👆 Click directly on the die you want to increase (+1) with '${cName}'!`);
    const encEl = document.getElementById("pending-encounter-panel");
    if (!appState.activeDiceOverlay && encEl && typeof encEl.scrollIntoView === "function") {
      encEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return;
  }

  if (cName === "Casus Belli") {
    const pend = gs && gs.pendingEncounter;
    if (!pend) {
      const reason = getCasusBelliProactiveDisabledReason(gs, viewer);
      if (reason) {
        showToast(reason, true);
        return;
      }
      openCasusBelliPvpModal(gs, viewer, card);
      return;
    }
    const pStage = pend.stage || "pre_decision";
    if (
      pStage !== "pre_decision" ||
      pend.isPvp ||
      !viewer ||
      pend.playerIndex !== viewer.index ||
      pend.interveningPlayerIndex != null ||
      pend.canInitiateCombat ||
      pend.combatMandatory
    ) {
      showToast(
        "Casus Belli can only be played during an initial NPC Encounter decision when combat is not already available, or proactively on your Night Delivery turn (Turn 2+).",
        true
      );
      return;
    }
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

function openPendingMissionOverflowModal(gs, viewer) {
  const vp = viewer || (gs ? getViewerPlayer(gs) : null);
  if (!vp || !Array.isArray(vp.missions) || vp.missions.length <= MAX_ACTIVE_MISSIONS) {
    closeModal();
    return;
  }
  const missions = vp.missions;
  const ovf = vp.pendingMissionOverflow || {};
  const allSooth = areAllMissionsSoothsayer(missions);
  const bondedCouriersActive = hasActiveClimateOption(gs, "missions_3");
  const eligibleMissions = missions.filter((m) => isMissionCancelableClient(vp, m));

  let selectedMissionId =
    eligibleMissions.length === 1 ? eligibleMissions[0].id : null;

  const describeCancelCost = (m) => {
    const src = m.source || "starting";
    if (src === "soothsayer") {
      return allSooth
        ? "No penalty (sealed Influence cards return to the deck)"
        : "Locked unless all 6 active missions are Soothsayer";
    }
    if (src === "encounter") {
      const hostileTxt = formatHostileFavorPenaltyText(m);
      return bondedCouriersActive
        ? `Hostile Favor (${hostileTxt}) + -10(d) Fine`
        : `Hostile Favor (${hostileTxt})`;
    }
    return bondedCouriersActive ? "-10(d) Bonded Couriers Fine" : "No penalty";
  };

  const confirmBtn = el("button", {
    type: "button",
    className: "btn btn-crimson",
    disabled: !selectedMissionId,
    text: "✕ Cancel Selected Mission",
    onClick: () => {
      if (!selectedMissionId) return;
      closeModal();
      sendGameAction({
        type: "cancel_mission",
        missionId: selectedMissionId,
      });
    },
  });

  const selectionSummaryNode = el("div", {
    style: {
      fontSize: "0.84rem",
      fontWeight: "600",
      color: "var(--text-main)",
    },
    text: "",
  });

  const cardWraps = new Map();

  const updateSelectionUi = () => {
    const sel = missions.find((m) => m.id === selectedMissionId) || null;
    for (const [mId, wrap] of cardWraps.entries()) {
      wrap.classList.toggle("is-selected", mId === selectedMissionId);
    }
    if (!sel) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Select a Mission Above to Cancel";
      selectionSummaryNode.textContent =
        eligibleMissions.length === 0
          ? "No eligible missions to cancel."
          : "Click one of the eligible missions above to preview its cancellation effect.";
      return;
    }
    const costText = describeCancelCost(sel);
    const cargoNote = sel.pickedUp ? ` • Discards loaded "${sel.item || "cargo"}"` : "";
    confirmBtn.disabled = false;
    confirmBtn.textContent = `✕ Cancel "${sel.name}" (${costText})`;
    selectionSummaryNode.textContent = `Selected: "${sel.name}" — ${costText}${cargoNote}`;
  };

  const gridNode = el(
    "div",
    { className: "mission-overflow-grid" },
    ...missions.map((m) => {
      const src = m.source || "starting";
      const cancelable = isMissionCancelableClient(vp, m);
      const isNew = Boolean(ovf.newMissionId && ovf.newMissionId === m.id);
      const isPenalty = src === "encounter" || (src !== "soothsayer" && bondedCouriersActive);
      const tagClass = !cancelable
        ? "is-locked"
        : isPenalty
        ? "is-penalty"
        : "is-free";
      const tagText = !cancelable
        ? "🔒 Soothsayer Locked (Not All 6 Soothsayer)"
        : src === "soothsayer"
        ? "✓ Free to Cancel (All 6 Soothsayer)"
        : src === "encounter"
        ? `👎 ${formatHostileFavorPenaltyText(m)}${bondedCouriersActive ? " + -10d" : ""}`
        : bondedCouriersActive
        ? "-10(d) Bonded Couriers Fine"
        : "✓ Free to Cancel (Starting)";

      const wrap = el(
        "div",
        {
          className: [
            "mission-overflow-card-wrap",
            cancelable ? "is-selectable" : "is-locked",
            isNew ? "is-new" : "",
          ]
            .filter(Boolean)
            .join(" "),
          onClick: cancelable
            ? () => {
                selectedMissionId = m.id;
                updateSelectionUi();
              }
            : undefined,
        },
        el(
          "div",
          {
            style: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "0.25rem",
              minHeight: "1.15rem",
            },
          },
          el("span", {
            style: {
              fontSize: "0.66rem",
              fontWeight: "800",
              textTransform: "uppercase",
              color: src === "soothsayer" ? "#5b21b6" : src === "encounter" ? "#b45309" : "#1e3a8a",
            },
            text: src === "soothsayer" ? "🔮 Soothsayer" : src === "encounter" ? "⚔️ Encounter" : "📜 Starting",
          }),
          isNew
            ? el("span", {
                style: {
                  fontSize: "0.64rem",
                  fontWeight: "800",
                  background: "#f59e0b",
                  color: "#fff",
                  padding: "1px 5px",
                  borderRadius: "4px",
                },
                text: "NEW 6th",
              })
            : null
        ),
        renderPhysicalMissionCardNode(m, {
          showStatusTag: true,
          canCancel: false,
          allSoothsayerOverflow: allSooth,
        }),
        el("div", {
          className: `mission-overflow-tag ${tagClass}`,
          text: m.pickedUp && cancelable ? `${tagText} • Drops cargo` : tagText,
        })
      );
      cardWraps.set(m.id, wrap);
      return wrap;
    })
  );

  updateSelectionUi();

  const headerDesc = ovf.newMissionName
    ? `You took on "${ovf.newMissionName}"${ovf.sourceLabel ? ` (${ovf.sourceLabel})` : ""}, giving you ${missions.length} active missions (max ${MAX_ACTIVE_MISSIONS}).`
    : `You currently have ${missions.length} active missions (max ${MAX_ACTIVE_MISSIONS}).`;
  const ruleDesc = allSooth
    ? "All 6 active missions are Soothsayer missions, so you may choose ANY 1 Soothsayer mission to cancel at no penalty (any sealed Influence cards return to the Influence deck)."
    : "Choose 1 active Starting or Encounter mission to cancel immediately. A Soothsayer mission can only be canceled if all six (6) active missions are Soothsayer missions. You cannot end your turn until you have 5 or fewer active missions.";

  showModal(
    `📜 6th Active Mission — Cancel 1 of ${missions.length} Missions`,
    el(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "0.75rem" } },
      el("div", {
        className: "banner-warning",
        style: { margin: "0", fontSize: "0.86rem", lineHeight: "1.45" },
        text: `${headerDesc} ${ruleDesc}`,
      }),
      gridNode,
      el(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "0.75rem",
            flexWrap: "wrap",
            paddingTop: "0.35rem",
            borderTop: "1px solid var(--border-subtle)",
          },
        },
        selectionSummaryNode,
        el(
          "div",
          { style: { display: "flex", gap: "0.5rem", alignItems: "center" } },
          el("button", {
            type: "button",
            className: "btn",
            text: "Inspect Board",
            onClick: closeModal,
          }),
          confirmBtn
        )
      )
    ),
    { wide: true }
  );
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

      const metaNode = ENCOUNTER_DECK_PROFILES[spec.key]
        ? renderEncounterDeckMetaBlockNode(gs, spec.key, {
            useLiveCounts: true,
            includeHistory: true,
            showFactionName: false,
          })
        : spec.key === "market"
        ? el(
            "div",
            { className: "encounter-deck-meta-box" },
            el("div", { className: "encounter-deck-meta-line", text: spec.shortDesc }),
            renderGoodsDeckCategoryStripNode(gs)
          )
        : spec.shortDesc
        ? el(
            "div",
            { className: "encounter-deck-meta-box" },
            el("div", { className: "encounter-deck-meta-line", text: spec.shortDesc })
          )
        : null;

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
        metaNode,
        el("div", { className: "scout-deck-tap-pill", text: tapPillLabel })
      );
    })
  );
}

function openInformantsTargetModal(gs, _viewer, card) {
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
          ALL_PICKER_DECK_SPECS,
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
    ),
    { wide: true }
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
        tType === "tile" && item && item.id
          ? el("div", {
            style: { fontSize: "0.74rem", fontWeight: "700", color: "var(--gold-bright)", marginBottom: "0.2rem" },
            text: `Tile ID: ${item.id}`,
          })
          : null,
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
                await sendGameAction({ type: "play_influence", cardId: matchFixingCard.id, fromGamble: true });
                const updatedViewer = getViewerPlayer(appState.gameState);
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

function openScoutModal(gs, viewer) {
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

  showModal(
    isEntryPhase
      ? "👁️ Pre-Night Initial Scout (Before Selecting Gate)"
      : "👁️ Free Scout Action (Once Per Turn)",
    el(
      "div",
      {},
      !isEntryPhase
        ? el("p", {
            style: { fontSize: "0.84rem", color: "var(--text-main)", marginTop: "0", marginBottom: "0.75rem" },
            text: "Use your 1 free Scout per turn at ANY time—before or after Moving and before or after Transacting. Scouting does NOT end your turn: you may keep taking remaining actions afterwards or click End Turn inside the preview.",
          })
        : null,
      el(
        "div",
        { style: { marginBottom: "1.1rem" } },
        el("div", {
          style: { fontWeight: "700", color: "var(--gold-bright)", fontSize: "0.9rem", marginBottom: "0.25rem" },
          text: "Option A: Tap Any of the 6 Card Decks to Scout Its Top Card",
        }),
        el("div", {
          style: { fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.5rem" },
          text: "Select from Patricii, Nefarii, Legionnaire, Goods & Guards, Missiones, or Influence by tapping directly on a deck below:",
        }),
        renderDeckCardBackPickerGrid(
          gs,
          ALL_PICKER_DECK_SPECS,
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
          id: "scout-modal-tile-btn",
          type: "button",
          className: "btn btn-primary",
          style: { width: "100%" },
          text: "👁️ Scout Selected Neighborhood Stack",
          onClick: () => executeTileScoutAction(gs, viewer || getViewerPlayer(gs), cellSelect.value),
        })
      )
    ),
    { wide: true }
  );
}

function openTrashModal(gs, viewer, prefillOpts = {}) {
  const infSelect = el(
    "select",
    { className: "form-input" },
    ...(viewer.influence || []).map((c) => el("option", { value: c.id, text: c.name }))
  );
  const initialCell = (prefillOpts && prefillOpts.cell && gs.romeBoard[prefillOpts.cell])
    ? prefillOpts.cell
    : appState.inspectedCell;
  const preferredMode = prefillOpts && prefillOpts.targetMode === "stack" ? "stack" : "revealed";

  const cellSelect = el(
    "select",
    { className: "form-input" },
    ...Object.keys(gs.romeBoard).map((coord) => {
      const cObj = gs.romeBoard[coord];
      const occCnt = ((gs.players) || []).filter(
        (p) => p.position === coord && !p.exitedRome && !p.eliminated
      ).length;
      const statusTag = cObj.revealed
        ? occCnt > 0
          ? "Exposed, Occupied"
          : "Exposed, Unoccupied"
        : "Unrevealed";
      return el("option", {
        value: coord,
        selected: coord === initialCell,
        text: `${coord} — ${cObj.name} (${statusTag}, ${cObj.stackCount ?? 12} in stack)`,
      });
    })
  );

  const cellStatusBox = el("div", { className: "trash-target-status-box" });
  const trashExposedBtn = el("button", {
    id: "trash-exposed-tile-btn",
    type: "button",
    className: "btn btn-crimson",
    text: "🗑️ Trash Exposed Face-Up Tile",
    onClick: () => {
      closeModal();
      sendGameAction({
        type: "delivery_trash",
        influenceCardId: infSelect.value,
        targetType: "tile",
        targetKey: cellSelect.value,
        targetMode: "revealed",
      });
    },
  });
  const trashStackBtn = el("button", {
    id: "trash-stack-tile-btn",
    type: "button",
    className: "btn",
    text: "🗑️ Bury Top Unrevealed Stack Tile",
    onClick: () => {
      closeModal();
      sendGameAction({
        type: "delivery_trash",
        influenceCardId: infSelect.value,
        targetType: "tile",
        targetKey: cellSelect.value,
        targetMode: "stack",
      });
    },
  });

  const refreshSelectedCellUi = () => {
    const coord = cellSelect.value;
    const cObj = (gs.romeBoard && gs.romeBoard[coord]) || null;
    const occNames = ((gs.players) || [])
      .filter((p) => p.position === coord && !p.exitedRome && !p.eliminated)
      .map((p) => p.name);
    const hasExposed = Boolean(cObj && cObj.revealed);
    const stackCnt = cObj ? Number(cObj.stackCount ?? 12) : 0;
    const revSummary =
      hasExposed && cObj.revealed
        ? [
            cObj.revealed.encounter ? `Center: ${cObj.revealed.encounter}` : "No Center Encounter",
            Array.isArray(cObj.revealed.sells) && cObj.revealed.sells.length > 0
              ? `Buys: ${cObj.revealed.sells.map((s) => s.category).join(", ")}`
              : "No Buyers",
          ].join(" • ")
        : "";

    trashExposedBtn.disabled = !hasExposed;
    trashStackBtn.disabled = stackCnt <= 0;
    trashExposedBtn.className =
      hasExposed && preferredMode === "revealed" ? "btn btn-crimson" : "btn";
    trashStackBtn.className =
      (!hasExposed || preferredMode === "stack") && stackCnt > 0 ? "btn btn-crimson" : "btn";

    cellStatusBox.innerHTML = "";
    if (hasExposed) {
      cellStatusBox.appendChild(
        el("div", {
          style: { fontWeight: "700", marginBottom: "0.2rem" },
          text: `${coord} (${cObj.name}) — Exposed Tile (${revSummary})`,
        })
      );
      cellStatusBox.appendChild(
        el("div", {
          text:
            occNames.length > 0
              ? `Occupied by ${occNames.join(", ")}: trashing the exposed tile sends it to the bottom and IMMEDIATELY flips the top unrevealed stack tile face-up (${stackCnt} available).`
              : `Unoccupied: trashing the exposed tile sends it to the bottom and leaves ${coord} unrevealed until a merchant enters it.`,
        })
      );
    } else {
      cellStatusBox.appendChild(
        el("div", {
          text: `${coord} (${cObj ? cObj.name : coord}) currently has no exposed face-up tile (${stackCnt} unrevealed tiles in stack). Use "Bury Top Unrevealed Stack Tile" to send the top face-down tile to the bottom.`,
        })
      );
    }
  };

  cellSelect.addEventListener("change", refreshSelectedCellUi);
  refreshSelectedCellUi();

  showModal(
    "🗑️ Trash Action (Discard 1 Influence to Bury Tile or Deck Card)",
    el(
      "div",
      {},
      el("p", {
        style: { fontSize: "0.84rem", color: "var(--text-main)", marginTop: "0", marginBottom: "0.75rem" },
        text: "Once per Delivery turn (before or after Moving, even while sharing a cell with another merchant), discard 1 Influence card to bury the top card of any of the 6 decks OR trash either an exposed face-up tile or the top unrevealed stack tile.",
      }),
      el("div", { className: "form-group" }, el("label", { text: "1. Influence Card to Discard" }), infSelect),
      el(
        "div",
        { style: { marginBottom: "1rem" } },
        el("div", {
          style: { fontWeight: "700", color: "var(--gold-bright)", fontSize: "0.86rem", marginBottom: "0.25rem" },
          text: "Option A: Tap Any of the 6 Decks to Bury Its Top Card to Bottom",
        }),
        el("div", {
          style: { fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.45rem" },
          text: "Supports Patricii, Nefarii, Legionnaire, Goods & Guards, Missiones, and Influence (the current top card cycles before your discarded Influence card goes underneath):",
        }),
        renderDeckCardBackPickerGrid(
          gs,
          ALL_PICKER_DECK_SPECS,
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
        el("div", { className: "form-group" }, el("label", { text: "Option B: Target Neighborhood Tile (Exposed Face-Up OR Unrevealed Stack)" }), cellSelect),
        cellStatusBox,
        el("div", { className: "trash-target-actions-grid" }, trashExposedBtn, trashStackBtn)
      )
    ),
    { wide: true }
  );
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
        const moveToBtn =
          document.getElementById("modal-move-to-btn") ||
          document.getElementById("scout-modal-move-to-btn");
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
      const viewer = getViewerPlayer(gs);

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
            openFaceUpTileUpCloseModal(
              gs,
              viewer,
              targetCoord,
              targetCell,
              getTileModalPreviewData(gs, viewer, targetCoord, targetCell),
              computeTileMoveOptsForTarget(gs, viewer, targetCoord)
            );
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
            openFaceUpTileUpCloseModal(
              gs,
              viewer,
              targetCoord,
              targetCell,
              getTileModalPreviewData(gs, viewer, targetCoord, targetCell),
              computeTileMoveOptsForTarget(gs, viewer, targetCoord)
            );
          }
          return;
        }
        if (hk.endTurn && k === hk.endTurn && gs.phase === "delivery" && gs.activePlayerIndex === viewer.index && !gs.pendingEncounter) {
          e.preventDefault();
          if (hasMissionOverflow(viewer, gs)) {
            openPendingMissionOverflowModal(gs, viewer);
            return;
          }
          if (hasPlayerBlockingPrompt(viewer, true, gs)) {
            showToast("Resolve your active prompt before ending your turn.", true);
            return;
          }
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

let _updateAvailableNotified = false;
window.addEventListener("nightmerchant:update-available", () => {
  if (_updateAvailableNotified) return;
  _updateAvailableNotified = true;
  showToast("A newer version of Night Merchant is available — save your input or refresh to update.");
});

window.addEventListener("DOMContentLoaded", () => {
  installDelayedHoverTooltips();
  installGlobalHotkeys();
  let resizeAbbrRaf = null;
  window.addEventListener("resize", () => {
    if (resizeAbbrRaf) cancelAnimationFrame(resizeAbbrRaf);
    resizeAbbrRaf = requestAnimationFrame(() => {
      resizeAbbrRaf = null;
      abbreviateSingleDotRivalNames();
    });
  });
  bootstrap();
});


