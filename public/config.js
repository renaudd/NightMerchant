/**
 * Copyright (c) 2026 Dashiell Renaud (https://dashiellrenaud.com)
 * Licensed under Creative Commons Attribution-NonCommercial-NoDerivatives 4.0
 * International (CC BY-NC-ND 4.0): https://creativecommons.org/licenses/by-nc-nd/4.0/
 * SPDX-License-Identifier: CC-BY-NC-ND-4.0
 */

(function () {
  var isLocalDev =
    typeof window !== "undefined" &&
    window.location &&
    (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost");

  window.NIGHTMERCHANT_CONFIG = window.NIGHTMERCHANT_CONFIG || {
    // Cloud Run backend URL in production; "" on localhost/127.0.0.1 for local server dev
    apiBaseUrl: isLocalDev ? "" : "https://nightmerchant-api-208043966891.us-west2.run.app",

    // Firebase Web App configuration (nightmerchant-f183d)
    firebaseConfig: {
      apiKey: "AIzaSyAw4TolZSm12UKGecSBLBJgIEcDTr88kOE",
      authDomain: "nightmerchant-f183d.firebaseapp.com",
      projectId: "nightmerchant-f183d",
      storageBucket: "nightmerchant-f183d.firebasestorage.app",
      messagingSenderId: "208043966891",
      appId: "1:208043966891:web:109f98abb8a060359f12ee",
      measurementId: "G-C0T498L6M7",
    },
  };
})();
