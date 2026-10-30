/**
 * Copyright (c) 2026 Dashiell Renaud (https://dashiellrenaud.com)
 * Licensed under Creative Commons Attribution-NonCommercial-NoDerivatives 4.0
 * International (CC BY-NC-ND 4.0): https://creativecommons.org/licenses/by-nc-nd/4.0/
 * SPDX-License-Identifier: CC-BY-NC-ND-4.0
 */

window.NIGHTMERCHANT_CONFIG = window.NIGHTMERCHANT_CONFIG || {
  // Cloud Run backend base URL in production (leave "" when serving frontend & API from same origin)
  apiBaseUrl: "",

  // Firebase Web App configuration (from Firebase Console -> Project Settings -> General -> Your Apps)
  firebaseConfig: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: "",
  },
};
