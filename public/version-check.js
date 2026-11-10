/**
 * Copyright (c) 2026 Dashiell Renaud (https://dashiellrenaud.com)
 * Licensed under Creative Commons Attribution-NonCommercial-NoDerivatives 4.0
 * International (CC BY-NC-ND 4.0): https://creativecommons.org/licenses/by-nc-nd/4.0/
 * SPDX-License-Identifier: CC-BY-NC-ND-4.0
 */

(function () {
  "use strict";

  var BURST_PARAM = "_nm_v";
  var ATTEMPT_STORAGE_KEY = "nm_version_reload_attempt";
  var RESUME_GAME_STORAGE_KEY = "nm_resume_game_id";
  var CHECK_THROTTLE_MS = 15000;
  var PERIODIC_INTERVAL_MS = 60000;
  var RELOAD_LOOP_GUARD_MS = 30000;
  var VALID_VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/;

  var bootedWithBurstVersion = null;
  var lastCheckStartedAt = 0;
  var checkInFlightPromise = null;
  var reloadScheduled = false;
  var deferredNoticeVersion = null;

  function safeSessionGet(key) {
    try {
      return typeof window.sessionStorage !== "undefined" ? window.sessionStorage.getItem(key) : null;
    } catch (_err) {
      return null;
    }
  }

  function safeSessionSet(key, val) {
    try {
      if (typeof window.sessionStorage !== "undefined") {
        window.sessionStorage.setItem(key, String(val));
      }
    } catch (_err) {}
  }

  function sanitizeVersion(raw) {
    if (typeof raw !== "string" && typeof raw !== "number") return null;
    var trimmed = String(raw).trim();
    return VALID_VERSION_RE.test(trimmed) ? trimmed : null;
  }

  function extractQueryParamVersion(srcOrHref) {
    if (!srcOrHref || typeof srcOrHref !== "string") return null;
    var match = srcOrHref.match(/[?&]v=([A-Za-z0-9._-]{1,32})(?:&|#|$)/);
    return match ? sanitizeVersion(match[1]) : null;
  }

  function cleanupBurstUrlParam() {
    try {
      var urlObj = new URL(window.location.href);
      var rawBurst = urlObj.searchParams.get(BURST_PARAM);
      if (rawBurst !== null) {
        bootedWithBurstVersion = sanitizeVersion(rawBurst);
        urlObj.searchParams.delete(BURST_PARAM);
        if (window.history && typeof window.history.replaceState === "function") {
          window.history.replaceState(null, "", urlObj.pathname + urlObj.search + urlObj.hash);
        }
      }
    } catch (_err) {}
  }

  function getLocalVersion() {
    try {
      var appScript = document.querySelector('script[src*="app.js"]');
      var v = appScript ? extractQueryParamVersion(appScript.getAttribute("src")) : null;
      if (v) return v;

      var meta = document.querySelector('meta[name="nm-version"]');
      v = meta ? sanitizeVersion(meta.getAttribute("content")) : null;
      if (v) return v;

      var cfgScript = document.querySelector('script[src*="config.js"]');
      v = cfgScript ? extractQueryParamVersion(cfgScript.getAttribute("src")) : null;
      if (v) return v;

      var cssLink = document.querySelector('link[href*="styles.css"]');
      v = cssLink ? extractQueryParamVersion(cssLink.getAttribute("href")) : null;
      if (v) return v;
    } catch (_err) {}
    return null;
  }

  function waitForDomParsed() {
    if (document.readyState !== "loading") {
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      document.addEventListener("DOMContentLoaded", function onReady() {
        resolve();
      }, { once: true });
    });
  }

  function buildRelativeNoCacheUrl(relFile) {
    var urlObj = new URL(relFile, window.location.href);
    urlObj.searchParams.set("_", String(Date.now()));
    return urlObj.toString();
  }

  function fetchRemoteVersion() {
    var versionJsonUrl;
    try {
      versionJsonUrl = buildRelativeNoCacheUrl("./version.json");
    } catch (_err) {
      return Promise.resolve(null);
    }

    return fetch(versionJsonUrl, {
      method: "GET",
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    })
      .then(function (resp) {
        if (!resp.ok) return null;
        return resp.json().catch(function () {
          return null;
        });
      })
      .then(function (data) {
        var parsed = data && typeof data === "object" ? sanitizeVersion(data.version) : null;
        if (parsed) return parsed;
        return fetchVersionFromIndexHtml();
      })
      .catch(function () {
        return fetchVersionFromIndexHtml();
      });
  }

  function fetchVersionFromIndexHtml() {
    var indexUrl;
    try {
      indexUrl = buildRelativeNoCacheUrl("./index.html");
    } catch (_err) {
      return Promise.resolve(null);
    }

    return fetch(indexUrl, {
      method: "GET",
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    })
      .then(function (resp) {
        if (!resp.ok) return null;
        return resp.text();
      })
      .then(function (htmlText) {
        if (!htmlText) return null;
        var match = htmlText.match(/app\.js\?v=([A-Za-z0-9._-]{1,32})/);
        if (match) return sanitizeVersion(match[1]);
        var metaMatch = htmlText.match(/<meta\s+name=["']nm-version["']\s+content=["']([A-Za-z0-9._-]{1,32})["']/i);
        return metaMatch ? sanitizeVersion(metaMatch[1]) : null;
      })
      .catch(function () {
        return null;
      });
  }

  function wasRecentlyAttempted(remoteVersion) {
    if (bootedWithBurstVersion && bootedWithBurstVersion === remoteVersion) {
      return true;
    }
    var rawAttempt = safeSessionGet(ATTEMPT_STORAGE_KEY);
    if (!rawAttempt) return false;
    try {
      var parsed = JSON.parse(rawAttempt);
      if (
        parsed &&
        parsed.version === remoteVersion &&
        typeof parsed.ts === "number" &&
        Date.now() - parsed.ts < RELOAD_LOOP_GUARD_MS
      ) {
        return true;
      }
    } catch (_err) {}
    return false;
  }

  function isUserEditingField() {
    var active = document.activeElement;
    if (!active) return false;
    var tag = String(active.tagName || "").toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean(active.isContentEditable);
  }

  function triggerReload(remoteVersion) {
    if (reloadScheduled || !remoteVersion) return false;
    if (wasRecentlyAttempted(remoteVersion)) return false;

    reloadScheduled = true;
    var activeGameId =
      typeof window.__NM_ACTIVE_GAME_ID__ === "string" ? window.__NM_ACTIVE_GAME_ID__.trim() : "";
    if (activeGameId && /^[A-Za-z0-9_-]{1,40}$/.test(activeGameId)) {
      safeSessionSet(RESUME_GAME_STORAGE_KEY, activeGameId);
    }
    safeSessionSet(
      ATTEMPT_STORAGE_KEY,
      JSON.stringify({ version: remoteVersion, ts: Date.now() })
    );

    try {
      var nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set(BURST_PARAM, remoteVersion);
      window.location.replace(nextUrl.toString());
      return true;
    } catch (_err) {
      window.location.reload();
      return true;
    }
  }

  function checkForUpdate(options) {
    var force = Boolean(options && options.force);
    var now = Date.now();
    if (!force && now - lastCheckStartedAt < CHECK_THROTTLE_MS) {
      return Promise.resolve({ updated: false, skipped: "throttled" });
    }
    if (checkInFlightPromise) {
      return checkInFlightPromise;
    }

    lastCheckStartedAt = now;
    checkInFlightPromise = Promise.all([waitForDomParsed(), fetchRemoteVersion()])
      .then(function (results) {
        var remoteVersion = results[1];
        var localVersion = getLocalVersion();
        if (!remoteVersion || !localVersion || remoteVersion === localVersion) {
          return { updated: false, localVersion: localVersion, remoteVersion: remoteVersion };
        }
        if (wasRecentlyAttempted(remoteVersion)) {
          return {
            updated: false,
            suppressed: true,
            localVersion: localVersion,
            remoteVersion: remoteVersion,
          };
        }
        if (!force && isUserEditingField()) {
          if (deferredNoticeVersion !== remoteVersion) {
            deferredNoticeVersion = remoteVersion;
            try {
              window.dispatchEvent(
                new CustomEvent("nightmerchant:update-available", {
                  detail: { localVersion: localVersion, remoteVersion: remoteVersion },
                })
              );
            } catch (_evtErr) {}
          }
          return {
            updated: false,
            deferred: true,
            localVersion: localVersion,
            remoteVersion: remoteVersion,
          };
        }
        var triggered = triggerReload(remoteVersion);
        return {
          updated: triggered,
          localVersion: localVersion,
          remoteVersion: remoteVersion,
        };
      })
      .finally(function () {
        checkInFlightPromise = null;
      });

    return checkInFlightPromise;
  }

  cleanupBurstUrlParam();

  window.NightMerchantVersion = {
    getLocalVersion: getLocalVersion,
    checkForUpdate: checkForUpdate,
    triggerReload: triggerReload,
  };

  // Run an immediate forced update check so stale mobile cached HTML reloads right away
  checkForUpdate({ force: true });

  window.addEventListener("pageshow", function (event) {
    if (event && event.persisted) {
      checkForUpdate({ force: true });
    }
  });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      checkForUpdate({ force: false });
    }
  });

  window.setInterval(function () {
    if (document.visibilityState !== "hidden") {
      checkForUpdate({ force: false });
    }
  }, PERIODIC_INTERVAL_MS);
})();
