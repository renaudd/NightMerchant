# Copyright (c) 2026 Dashiell Renaud (https://dashiellrenaud.com)
# Licensed under Creative Commons Attribution-NonCommercial-NoDerivatives 4.0
# International (CC BY-NC-ND 4.0): https://creativecommons.org/licenses/by-nc-nd/4.0/
# SPDX-License-Identifier: CC-BY-NC-ND-4.0

import hmac
import http.cookies
import importlib
import json
import mimetypes
import os
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Set, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db as db_defaults
import email_service
import game_engine
import storage

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_DIR = os.path.realpath(os.path.join(ROOT_DIR, "public"))

MAX_BODY_BYTES = 65536
SESSION_COOKIE_NAME = "nm_session"
SECURE_SESSION_COOKIE_NAME = "__Secure-nm_session"

DEFAULT_ALLOWED_ORIGINS: Set[str] = {
    "https://dashiellrenaud.com",
    "https://www.dashiellrenaud.com",
    "http://127.0.0.1:8080",
    "http://localhost:8080",
}

REFERENCE_CATALOG = [
    {"id": "GameBoards", "title": "Rome 211 A.D. & Ostia Market Boards (Original)", "category": "Boards", "url": "./assets/reference/GameBoards.jpg"},
    {"id": "ClockBoard", "title": "Clock & Turn Flow Tracker (Original)", "category": "Boards", "url": "./assets/reference/ClockBoard.jpg"},
    {"id": "Grain", "title": "Grain Market Cards", "category": "Market Cards", "url": "./assets/reference/Grain.jpg"},
    {"id": "CheapWine", "title": "Cheap Wine Market Cards", "category": "Market Cards", "url": "./assets/reference/CheapWine.jpg"},
    {"id": "FineWine", "title": "Fine Wine Market Cards", "category": "Market Cards", "url": "./assets/reference/FineWine.jpg"},
    {"id": "MeatAnimals", "title": "Meat Animals Market Cards", "category": "Market Cards", "url": "./assets/reference/MeatAnimals.jpg"},
    {"id": "ExoticAnimals", "title": "Exotic Animals Market Cards", "category": "Market Cards", "url": "./assets/reference/ExoticAnimals.jpg"},
    {"id": "Weapons", "title": "Weapons Market Cards", "category": "Market Cards", "url": "./assets/reference/Weapons.jpg"},
    {"id": "Marble", "title": "Marble Market Cards", "category": "Market Cards", "url": "./assets/reference/Marble.jpg"},
    {"id": "Guards", "title": "Guards Market Cards", "category": "Market Cards", "url": "./assets/reference/Guards.jpg"},
    {"id": "Missiones1", "title": "Missiones Deck (Sheet 1)", "category": "Missions & Influence", "url": "./assets/reference/Missiones1.jpg"},
    {"id": "Missiones2", "title": "Missiones Deck (Sheet 2)", "category": "Missions & Influence", "url": "./assets/reference/Missiones2.jpg"},
    {"id": "Missiones3", "title": "Missiones Deck (Sheet 3)", "category": "Missions & Influence", "url": "./assets/reference/Missiones3.jpg"},
    {"id": "InfluenceCards1", "title": "Influence Deck (Sheet 1)", "category": "Missions & Influence", "url": "./assets/reference/InfluenceCards1.jpg"},
    {"id": "InfluenceCards2", "title": "Influence Deck (Sheet 2)", "category": "Missions & Influence", "url": "./assets/reference/InfluenceCards2.jpg"},
    {"id": "InfluenceCards3", "title": "Influence Deck (Sheet 3)", "category": "Missions & Influence", "url": "./assets/reference/InfluenceCards3.jpg"},
    {"id": "InfluenceCards4", "title": "Influence Deck (Sheet 4)", "category": "Missions & Influence", "url": "./assets/reference/InfluenceCards4.jpg"},
    {"id": "Patricii1", "title": "Patricii Encounters (Sheet 1)", "category": "Encounter Decks", "url": "./assets/reference/Patricii1.jpg"},
    {"id": "Patricii2", "title": "Patricii Encounters (Sheet 2)", "category": "Encounter Decks", "url": "./assets/reference/Patricii2.jpg"},
    {"id": "Legionnaires1", "title": "Legiones Encounters (Sheet 1)", "category": "Encounter Decks", "url": "./assets/reference/Legionnaires1.jpg"},
    {"id": "Legionnaires2", "title": "Legiones Encounters (Sheet 2)", "category": "Encounter Decks", "url": "./assets/reference/Legionnaires2.jpg"},
    {"id": "Nefarii1", "title": "Nefarii Encounters (Sheet 1)", "category": "Encounter Decks", "url": "./assets/reference/Nefarii1.jpg"},
    {"id": "Nefarii2", "title": "Nefarii Encounters (Sheet 2)", "category": "Encounter Decks", "url": "./assets/reference/Nefarii2.jpg"},
]

_rate_lock = threading.Lock()
_rate_buckets: Dict[str, List[float]] = {}
_game_locks_lock = threading.Lock()
_game_locks: Dict[str, threading.Lock] = {}
_engine_reload_lock = threading.Lock()
_engine_last_mtime: float = (
    os.path.getmtime(game_engine.__file__) if getattr(game_engine, "__file__", None) else 0.0
)


def _allowed_origins() -> Set[str]:
    extra = {
        o.strip().rstrip("/")
        for o in os.getenv("NIGHTMERCHANT_ALLOWED_ORIGINS", "").split(",")
        if o.strip()
    }
    return DEFAULT_ALLOWED_ORIGINS | extra


def _build_public_firebase_config() -> Optional[Dict[str, str]]:
    if not storage.is_firebase_enabled():
        return None
    api_key = (
        os.getenv("FIREBASE_CLIENT_API_KEY", "").strip("<>\"' \t\r\n")
        or os.getenv("FIREBASE_WEB_API_KEY", "").strip("<>\"' \t\r\n")
    )
    project_id = os.getenv("FIREBASE_PROJECT_ID", "").strip("<>\"' \t\r\n")
    if not api_key or not project_id:
        return None
    auth_domain = (
        os.getenv("FIREBASE_AUTH_DOMAIN", "").strip()
        or f"{project_id}.firebaseapp.com"
    )
    cfg: Dict[str, str] = {
        "apiKey": api_key,
        "authDomain": auth_domain,
        "projectId": project_id,
    }
    app_id = os.getenv("FIREBASE_APP_ID", "").strip()
    if app_id:
        cfg["appId"] = app_id
    return cfg


def _ensure_fresh_engine() -> None:
    global _engine_last_mtime
    eng_file = getattr(game_engine, "__file__", None)
    if not eng_file:
        return
    try:
        cur_mtime = os.path.getmtime(eng_file)
    except OSError:
        return
    if cur_mtime > _engine_last_mtime:
        with _engine_reload_lock:
            if cur_mtime > _engine_last_mtime:
                importlib.reload(game_engine)
                _engine_last_mtime = cur_mtime


def get_game_lock(game_id: str) -> threading.Lock:
    with _game_locks_lock:
        if game_id not in _game_locks:
            _game_locks[game_id] = threading.Lock()
        return _game_locks[game_id]


def _sanitize_for_user(
    state: Optional[Dict[str, Any]],
    user_id: Optional[int],
    summary: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    if not state or "players" not in state:
        return None
    s = summary or {}
    return game_engine.sanitize_state_for_player(
        state,
        user_id,
        host_user_id=s.get("hostUserId"),
        speed_mode=s.get("speedMode"),
        turn_time_limit_minutes=s.get("turnTimeLimitMinutes"),
        next_timeout_at=s.get("nextTimeoutAt"),
    )


def _apply_fast_timeouts_locked(
    store_mod: Any,
    game_id: str,
    viewer_user: Optional[Dict[str, Any]] = None,
) -> Optional[Tuple[Dict[str, Any], Dict[str, Any], List[int]]]:
    full = store_mod.get_game_full(game_id, viewer_user=viewer_user)
    if not full or not full[0]:
        return None
    summary, state = full
    if not state or "players" not in state or summary.get("status") != "active":
        return summary, state, []
    state.setdefault("hostUserId", summary.get("hostUserId"))
    state["speedMode"] = summary.get("speedMode", state.get("speedMode", "normal"))
    state["turnTimeLimitMinutes"] = summary.get("turnTimeLimitMinutes", state.get("turnTimeLimitMinutes"))
    kicked = game_engine.process_fast_timeouts(state)
    needs_sync_save = (
        summary.get("speedMode") == "fast"
        and summary.get("nextTimeoutAt") is None
        and bool(game_engine.get_blocking_player_indices(state))
    )
    if kicked or needs_sync_save:
        store_mod.save_game_state(game_id, state, was_Already_Finished=False)
        summary = store_mod.get_game_summary(game_id, viewer_user=viewer_user) or summary
    return summary, state, kicked


def _sweep_due_fast_games(store_mod: Optional[Any] = None) -> None:
    st = store_mod or storage.get_backend()
    try:
        due_ids = st.list_active_fast_game_ids_due()
    except Exception:
        return
    for gid in due_ids:
        lock = get_game_lock(gid)
        with lock:
            try:
                _apply_fast_timeouts_locked(st, gid, viewer_user=None)
            except Exception:
                pass


def check_rate_limit(key: str, limit: int, window_sec: float = 60.0) -> bool:
    now = time.time()
    with _rate_lock:
        timestamps = _rate_buckets.get(key, [])
        cutoff = now - window_sec
        timestamps = [t for t in timestamps if t > cutoff]
        if len(timestamps) >= limit:
            _rate_buckets[key] = timestamps
            return False
        timestamps.append(now)
        _rate_buckets[key] = timestamps
        return True


class NightMerchantHandler(BaseHTTPRequestHandler):
    server_version = "NightMerchant/1.0"
    sys_version = ""

    def log_message(self, fmt: str, *args: Any) -> None:
        # Quiet standard logging; avoid leaking sensitive tokens or headers
        pass

    def _apply_cors_headers(self) -> bool:
        origin = (self.headers.get("Origin") or "").strip().rstrip("/")
        if not origin:
            return True
        if origin in _allowed_origins():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, Authorization")
            self.send_header("Vary", "Origin")
            return True
        return False

    def _apply_security_headers(self, is_api: bool = False) -> None:
        self._apply_cors_headers()
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; "
            "img-src 'self' data: https://*.googleusercontent.com; "
            "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; "
            "script-src 'self' https://www.gstatic.com https://apis.google.com https://accounts.google.com/gsi/client; "
            "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com https://*.run.app https://accounts.google.com/gsi/; "
            "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://accounts.google.com/gsi/; "
            "object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        )
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        if is_api:
            self.send_header("Cache-Control", "no-store")

    def _send_json(self, status_code: int, payload: Dict[str, Any], set_cookie: Optional[str] = None) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self._apply_security_headers(is_api=True)
        if set_cookie:
            self.send_header("Set-Cookie", set_cookie)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        content_len_str = self.headers.get("Content-Length", "0")
        try:
            content_len = int(content_len_str)
        except ValueError:
            return None, "Invalid Content-Length header."
        if content_len < 0 or content_len > MAX_BODY_BYTES:
            return None, "Request payload too large."
        if content_len == 0:
            return {}, None
        raw = self.rfile.read(content_len)
        try:
            parsed = json.loads(raw.decode("utf-8"))
            if not isinstance(parsed, dict):
                return None, "JSON body must be an object."
            return parsed, None
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None, "Malformed JSON payload."

    def _get_session_cookie(self) -> Optional[str]:
        cookie_hdr = self.headers.get("Cookie")
        if not cookie_hdr:
            return None
        jar = http.cookies.SimpleCookie()
        try:
            jar.load(cookie_hdr)
        except http.cookies.CookieError:
            return None
        for cname in (SECURE_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME):
            morsel = jar.get(cname)
            if morsel and morsel.value:
                return morsel.value
        return None

    def _format_session_cookie(self, token: str, max_age: int = db_defaults.SESSION_TTL_SECONDS) -> str:
        is_https = self.headers.get("X-Forwarded-Proto", "").lower() == "https"
        cookie_name = SECURE_SESSION_COOKIE_NAME if is_https else SESSION_COOKIE_NAME
        parts = [
            f"{cookie_name}={token}",
            "HttpOnly",
            "SameSite=Lax",
            "Path=/",
            f"Max-Age={max_age}",
        ]
        if is_https:
            parts.append("Secure")
        return "; ".join(parts)

    def _get_bearer_token(self) -> Optional[str]:
        auth_hdr = (self.headers.get("Authorization") or "").strip()
        if auth_hdr.lower().startswith("bearer "):
            tok = auth_hdr[7:].strip()
            return tok if tok else None
        return None

    def _resolve_request_user(self) -> Tuple[Optional[Dict[str, Any]], str]:
        """Return (user_dict, auth_mode) where auth_mode is 'bearer', 'cookie', or 'none'."""
        store = storage.get_backend()
        bearer = self._get_bearer_token()
        if bearer and storage.is_firebase_enabled() and hasattr(store, "verify_and_sync_firebase_id_token"):
            fb_user, err = store.verify_and_sync_firebase_id_token(bearer)
            if fb_user and not err:
                return fb_user, "bearer"

        raw_token = self._get_session_cookie()
        if raw_token:
            c_user = store.get_session_user(raw_token)
            if c_user:
                return c_user, "cookie"
        return None, "none"

    def _require_auth(self, require_csrf: bool = True) -> Optional[Dict[str, Any]]:
        user, auth_mode = self._resolve_request_user()
        if not user:
            self._send_json(401, {"ok": False, "error": "Authentication required. Please sign in to the Members Portal."})
            return None
        # Cookie-authenticated state-changing requests strictly require matching CSRF token
        if require_csrf and auth_mode == "cookie":
            csrf_hdr = self.headers.get("X-CSRF-Token", "")
            expected_csrf = user.get("csrfToken", "")
            if not csrf_hdr or not expected_csrf or not hmac.compare_digest(csrf_hdr, expected_csrf):
                self._send_json(403, {"ok": False, "error": "Invalid or missing CSRF token."})
                return None
        return user

    def do_OPTIONS(self) -> None:
        parsed_url = urllib.parse.urlparse(self.path)
        if not parsed_url.path.startswith("/api/"):
            self._send_json(405, {"ok": False, "error": "Method not allowed."})
            return
        origin = (self.headers.get("Origin") or "").strip().rstrip("/")
        if origin and origin not in _allowed_origins():
            self._send_json(403, {"ok": False, "error": "Origin not permitted."})
            return
        self.send_response(204)
        self._apply_security_headers(is_api=True)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self) -> None:
        self._handle_get_or_head(head_only=True)

    def do_GET(self) -> None:
        self._handle_get_or_head(head_only=False)

    def _normalize_route_path(self, raw_path: str) -> str:
        if raw_path == "/nightmerchant":
            return "/"
        if raw_path.startswith("/nightmerchant/"):
            return raw_path[len("/nightmerchant"):]
        return raw_path

    def _handle_get_or_head(self, head_only: bool = False) -> None:
        parsed_url = urllib.parse.urlparse(self.path)
        path = self._normalize_route_path(parsed_url.path)

        if path.startswith("/api/"):
            client_ip = self.client_address[0] if self.client_address else "local"
            if not check_rate_limit(f"api:{client_ip}", 240, 60.0):
                self._send_json(429, {"ok": False, "error": "Too many requests. Please slow down."})
                return
            try:
                self._handle_api_get(path)
            except Exception as exc:
                sys.stderr.write(f"[NightMerchant] Unhandled API GET error on {path}: {type(exc).__name__}\n")
                try:
                    self._send_json(500, {"ok": False, "error": "An unexpected server error occurred. Please try again."})
                except Exception:
                    pass
            return

        # Serve static files from PUBLIC_DIR with strict path traversal protection
        rel_path = urllib.parse.unquote(path).lstrip("/")
        if not rel_path or rel_path == "index.html":
            rel_path = "index.html"

        candidate = os.path.realpath(os.path.join(PUBLIC_DIR, rel_path))
        if not (candidate == PUBLIC_DIR or candidate.startswith(PUBLIC_DIR + os.sep)):
            self._send_json(403, {"ok": False, "error": "Access denied."})
            return

        if not os.path.isfile(candidate):
            # SPA fallback to index.html for non-asset routes
            if not rel_path.startswith("assets/") and "." not in os.path.basename(rel_path):
                candidate = os.path.join(PUBLIC_DIR, "index.html")
            else:
                self._send_json(404, {"ok": False, "error": "File not found."})
                return

        ctype, _ = mimetypes.guess_type(candidate)
        if not ctype:
            ctype = "application/json" if candidate.endswith(".json") else "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype = f"{ctype}; charset=utf-8"

        try:
            with open(candidate, "rb") as fh:
                data = fh.read()
        except OSError:
            self._send_json(500, {"ok": False, "error": "Unable to read static asset."})
            return

        self.send_response(200)
        self._apply_security_headers(is_api=False)
        if candidate.endswith(("version.json", ".html")):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        elif candidate.endswith((".js", ".css")):
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        else:
            self.send_header("Cache-Control", "public, max-age=86400")
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if not head_only:
            self.wfile.write(data)

    def _handle_api_get(self, path: str) -> None:
        _ensure_fresh_engine()
        store = storage.get_backend()

        if path == "/api/health":
            self._send_json(
                200,
                {
                    "ok": True,
                    "storage": "firebase" if storage.is_firebase_enabled() else "sqlite",
                    "emailConfigured": email_service.is_email_configured(),
                },
            )
            return

        if path == "/api/auth/me":
            user, _ = self._resolve_request_user()
            google_client_id = os.getenv("GOOGLE_CLIENT_ID", "")
            fb_client_cfg = _build_public_firebase_config()
            if not user:
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "authenticated": False,
                        "user": None,
                        "csrfToken": None,
                        "googleClientId": google_client_id,
                        "firebaseEnabled": storage.is_firebase_enabled(),
                        "firebaseConfig": fb_client_cfg,
                    },
                )
                return
            csrf = user.pop("csrfToken", None)
            user.pop("_firebaseCustomToken", None)
            self._send_json(
                200,
                {
                    "ok": True,
                    "authenticated": True,
                    "user": user,
                    "csrfToken": csrf,
                    "googleClientId": google_client_id,
                    "firebaseEnabled": storage.is_firebase_enabled(),
                    "firebaseConfig": fb_client_cfg,
                },
            )
            return

        if path == "/api/portal/overview":
            user = self._require_auth(require_csrf=False)
            if not user:
                return
            _sweep_due_fast_games(store)
            games = store.list_games(limit=30, viewer_user=user)
            leaderboard = store.get_leaderboard()
            fresh_user = store.get_user_by_id(user["id"])
            self._send_json(
                200,
                {
                    "ok": True,
                    "user": fresh_user,
                    "games": games,
                    "leaderboard": leaderboard,
                    "botPersonas": game_engine.BOT_PERSONAS,
                    "botDifficulties": list(game_engine.BOT_DIFFICULTIES),
                    "referenceCatalog": REFERENCE_CATALOG,
                },
            )
            return

        if path == "/api/profile/completed-games":
            user = self._require_auth(require_csrf=False)
            if not user:
                return
            completed_games = store.get_user_completed_games(user["id"])
            fresh_user = store.get_user_by_id(user["id"])
            self._send_json(
                200,
                {
                    "ok": True,
                    "completedGames": completed_games,
                    "user": fresh_user,
                },
            )
            return

        m_game = re.match(r"^/api/games/([a-f0-9]{6,24})$", path)
        if m_game:
            user = self._require_auth(require_csrf=False)
            if not user:
                return
            game_id = m_game.group(1)
            with get_game_lock(game_id):
                resolved = _apply_fast_timeouts_locked(store, game_id, viewer_user=user)
                if not resolved:
                    self._send_json(404, {"ok": False, "error": "Game not found."})
                    return
                summary, state, _kicked = resolved
                sanitized = _sanitize_for_user(state, user["id"], summary)
                self._send_json(200, {"ok": True, "summary": summary, "state": sanitized})
            return

        self._send_json(404, {"ok": False, "error": "Unknown API endpoint."})

    def do_POST(self) -> None:
        try:
            self._handle_api_post()
        except Exception as exc:
            sys.stderr.write(f"[NightMerchant] Unhandled API POST error on {self.path}: {type(exc).__name__}\n")
            try:
                self._send_json(500, {"ok": False, "error": "An unexpected server error occurred. Please try again."})
            except Exception:
                pass

    def _handle_api_post(self) -> None:
        _ensure_fresh_engine()
        store = storage.get_backend()
        parsed_url = urllib.parse.urlparse(self.path)
        path = self._normalize_route_path(parsed_url.path)
        client_ip = self.client_address[0] if self.client_address else "local"

        origin = (self.headers.get("Origin") or "").strip().rstrip("/")
        if origin and origin not in _allowed_origins():
            self._send_json(403, {"ok": False, "error": "Origin not permitted."})
            return

        if path.startswith("/api/auth/"):
            if not check_rate_limit(f"auth:{client_ip}", 25, 60.0):
                self._send_json(429, {"ok": False, "error": "Too many authentication attempts. Please wait a minute."})
                return
        else:
            if not check_rate_limit(f"api_post:{client_ip}", 180, 60.0):
                self._send_json(429, {"ok": False, "error": "Rate limit exceeded."})
                return

        body, err = self._read_json_body()
        if err or body is None:
            self._send_json(400, {"ok": False, "error": err or "Invalid request body."})
            return

        if path == "/api/auth/register":
            username = str(body.get("username", ""))
            email = str(body.get("email", ""))
            display_name = str(body.get("displayName", "") or username)
            password = str(body.get("password", ""))
            preferred_color = store.normalize_cart_color(str(body.get("preferredColor", "Z1")), "Z1")

            user, c_err = store.create_user(username, display_name, password, preferred_color, email=email)
            if c_err or not user:
                self._send_json(400, {"ok": False, "error": c_err or "Registration failed."})
                return
            fb_custom_token = user.pop("_firebaseCustomToken", None)
            raw_token, csrf_token = store.create_session(user["id"])
            cookie_str = self._format_session_cookie(raw_token)
            self._send_json(
                201,
                {"ok": True, "user": user, "csrfToken": csrf_token, "firebaseCustomToken": fb_custom_token},
                set_cookie=cookie_str,
            )
            return

        if path == "/api/auth/login":
            username = str(body.get("username", ""))
            password = str(body.get("password", ""))
            user, a_err = store.authenticate_user(username, password)
            if a_err or not user:
                self._send_json(401, {"ok": False, "error": a_err or "Invalid credentials."})
                return
            fb_custom_token = user.pop("_firebaseCustomToken", None)
            raw_token, csrf_token = store.create_session(user["id"])
            cookie_str = self._format_session_cookie(raw_token)
            self._send_json(
                200,
                {"ok": True, "user": user, "csrfToken": csrf_token, "firebaseCustomToken": fb_custom_token},
                set_cookie=cookie_str,
            )
            return

        if path == "/api/auth/demo":
            if storage.is_firebase_enabled() or not hasattr(store, "get_or_create_local_demo_user"):
                self._send_json(403, {"ok": False, "error": "Sandbox demo sign-in is disabled in production."})
                return
            user, d_err = store.get_or_create_local_demo_user()
            if d_err or not user:
                self._send_json(500, {"ok": False, "error": d_err or "Could not create local demo session."})
                return
            raw_token, csrf_token = store.create_session(user["id"])
            cookie_str = self._format_session_cookie(raw_token)
            self._send_json(
                200,
                {"ok": True, "user": user, "csrfToken": csrf_token},
                set_cookie=cookie_str,
            )
            return

        if path == "/api/auth/firebase":
            if not storage.is_firebase_enabled() or not hasattr(store, "verify_and_sync_firebase_id_token"):
                self._send_json(400, {"ok": False, "error": "Firebase Authentication is not enabled on this server."})
                return
            id_token = str(body.get("idToken") or self._get_bearer_token() or "").strip()
            username_opt = str(body.get("username", "")).strip() or None
            display_opt = str(body.get("displayName", "")).strip() or None
            pref_color = store.normalize_cart_color(str(body.get("preferredColor", "Z3")), "Z3")
            user, f_err = store.verify_and_sync_firebase_id_token(
                id_token=id_token,
                username=username_opt,
                display_name=display_opt,
                preferred_color=pref_color,
            )
            if f_err or not user:
                self._send_json(401, {"ok": False, "error": f_err or "Firebase sign-in failed."})
                return
            user.pop("csrfToken", None)
            raw_token, csrf_token = store.create_session(user["id"])
            cookie_str = self._format_session_cookie(raw_token)
            self._send_json(200, {"ok": True, "user": user, "csrfToken": csrf_token}, set_cookie=cookie_str)
            return

        if path == "/api/auth/google":
            preferred_color = store.normalize_cart_color(str(body.get("preferredColor", "Z3")), "Z3")
            fb_id_token = str(body.get("idToken", "")).strip()
            if fb_id_token and storage.is_firebase_enabled() and hasattr(store, "verify_and_sync_firebase_id_token"):
                user, g_err = store.verify_and_sync_firebase_id_token(
                    id_token=fb_id_token,
                    display_name=str(body.get("displayName", "")).strip() or None,
                    preferred_color=preferred_color,
                )
                if g_err or not user:
                    self._send_json(401, {"ok": False, "error": g_err or "Google sign-in failed."})
                    return
                user.pop("csrfToken", None)
                raw_token, csrf_token = store.create_session(user["id"])
                cookie_str = self._format_session_cookie(raw_token)
                self._send_json(200, {"ok": True, "user": user, "csrfToken": csrf_token}, set_cookie=cookie_str)
                return

            google_client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
            credential = str(body.get("credential", "")).strip()
            verified_token = False

            if google_client_id:
                if not credential:
                    self._send_json(401, {"ok": False, "error": "Verified Google ID token is required."})
                    return
                try:
                    verify_url = "https://oauth2.googleapis.com/tokeninfo?" + urllib.parse.urlencode(
                        {"id_token": credential}
                    )
                    with urllib.request.urlopen(verify_url, timeout=5.0) as resp:
                        claims = json.loads(resp.read().decode("utf-8"))
                except Exception:
                    self._send_json(401, {"ok": False, "error": "Google authentication token could not be verified."})
                    return

                iss = str(claims.get("iss", ""))
                aud = str(claims.get("aud", ""))
                email_verified = str(claims.get("email_verified", "")).lower() in ("true", "1")
                if iss not in ("accounts.google.com", "https://accounts.google.com") or aud != google_client_id or not email_verified:
                    self._send_json(401, {"ok": False, "error": "Invalid Google authentication claims."})
                    return
                exp_raw = claims.get("exp")
                if exp_raw is not None:
                    try:
                        if int(exp_raw) <= int(time.time()):
                            self._send_json(401, {"ok": False, "error": "Expired Google authentication token."})
                            return
                    except (TypeError, ValueError):
                        self._send_json(401, {"ok": False, "error": "Invalid Google authentication claims."})
                        return
                email = str(claims.get("email", "")).strip()
                display_name = str(claims.get("name", "")).strip()
                google_sub = str(claims.get("sub", "")).strip()
                verified_token = True
            else:
                if storage.is_firebase_enabled():
                    self._send_json(401, {"ok": False, "error": "Verified Firebase Google Sign-In token is required."})
                    return
                # Local loopback sandbox mode when neither Firebase nor GOOGLE_CLIENT_ID is configured
                # TODO(security): Set FIREBASE_PROJECT_ID or GOOGLE_CLIENT_ID in production to enforce OIDC verification.
                email = str(body.get("email", "")).strip()
                display_name = str(body.get("displayName", "")).strip()
                google_sub = str(body.get("googleSub", "")).strip()

            user, g_err = store.authenticate_or_create_google_user(
                email=email,
                display_name=display_name,
                google_sub=google_sub,
                preferred_color=preferred_color,
                verified_token=verified_token,
            )
            if g_err or not user:
                self._send_json(400, {"ok": False, "error": g_err or "Google sign-in failed."})
                return
            fb_custom_token = user.pop("_firebaseCustomToken", None)
            user.pop("csrfToken", None)
            raw_token, csrf_token = store.create_session(user["id"])
            cookie_str = self._format_session_cookie(raw_token)
            res_payload: Dict[str, Any] = {"ok": True, "user": user, "csrfToken": csrf_token}
            if fb_custom_token:
                res_payload["firebaseCustomToken"] = fb_custom_token
            self._send_json(200, res_payload, set_cookie=cookie_str)
            return

        if path == "/api/auth/logout":
            user = self._require_auth(require_csrf=True)
            if not user:
                return
            store.invalidate_user_sessions(user["id"])
            clear_cookie = self._format_session_cookie("", max_age=0)
            self._send_json(200, {"ok": True, "message": "Signed out."}, set_cookie=clear_cookie)
            return

        if path == "/api/profile/set-username":
            user = self._require_auth(require_csrf=True)
            if not user:
                return
            if not check_rate_limit(f"set_uname:{client_ip}:{user['id']}", 15, 60.0):
                self._send_json(429, {"ok": False, "error": "Too many username attempts. Please wait a minute."})
                return
            raw_uname = str(body.get("username", ""))
            updated_user, u_err = store.set_permanent_username(user_id=user["id"], username=raw_uname)
            if u_err or not updated_user:
                self._send_json(400, {"ok": False, "error": u_err or "Could not set permanent username."})
                return
            self._send_json(
                200,
                {
                    "ok": True,
                    "message": f"Permanent Collegium username @{updated_user['username']} confirmed!",
                    "user": updated_user,
                },
            )
            return

        if path == "/api/profile/update":
            user = self._require_auth(require_csrf=True)
            if not user:
                return
            display_name = body.get("displayName")
            email = body.get("email")
            preferred_color = body.get("preferredColor")
            current_password = body.get("currentPassword")
            new_password = body.get("newPassword")
            settings = body.get("settings")
            updated_user, u_err = store.update_user_profile(
                user_id=user["id"],
                display_name=str(display_name) if display_name is not None else None,
                email=str(email) if email is not None else None,
                preferred_color=str(preferred_color) if preferred_color is not None else None,
                current_password=str(current_password) if current_password else None,
                new_password=str(new_password) if new_password else None,
                settings=settings if isinstance(settings, dict) else None,
            )
            if u_err or not updated_user:
                self._send_json(400, {"ok": False, "error": u_err or "Could not update profile."})
                return
            self._send_json(200, {"ok": True, "message": "Profile settings saved.", "user": updated_user})
            return

        if path.startswith("/api/games/"):
            user = self._require_auth(require_csrf=True)
            if not user:
                return
            if user.get("needsUsernameSetup"):
                self._send_json(
                    400,
                    {
                        "ok": False,
                        "error": "Please choose your permanent Collegium username before creating or joining games.",
                    },
                )
                return

        if path == "/api/games/create":
            user = self._require_auth(require_csrf=True)
            if not user:
                return
            name = str(body.get("name", ""))
            try:
                max_players = max(2, min(6, int(body.get("maxPlayers", 4))))
                bot_count = max(0, min(5, int(body.get("botCount", 2))))
            except (TypeError, ValueError):
                self._send_json(400, {"ok": False, "error": "Invalid player or bot count."})
                return

            raw_speed = body.get("speedMode", "normal")
            if raw_speed is None or str(raw_speed).strip() == "":
                speed_mode = "normal"
            else:
                cand_speed = str(raw_speed).strip().lower()
                if cand_speed not in ("normal", "fast"):
                    self._send_json(400, {"ok": False, "error": "Invalid speed mode. Choose 'normal' or 'fast'."})
                    return
                speed_mode = cand_speed

            turn_time_limit_minutes: Optional[int] = None
            if speed_mode == "fast":
                raw_limit = (
                    6
                    if ("turnTimeLimitMinutes" not in body or body.get("turnTimeLimitMinutes") is None)
                    else body.get("turnTimeLimitMinutes")
                )
                if isinstance(raw_limit, bool):
                    self._send_json(400, {"ok": False, "error": "Fast game turn limit must be an integer between 1 and 12 minutes."})
                    return
                try:
                    parsed_limit = int(raw_limit)
                except (TypeError, ValueError):
                    self._send_json(400, {"ok": False, "error": "Fast game turn limit must be an integer between 1 and 12 minutes."})
                    return
                if (isinstance(raw_limit, float) and raw_limit != parsed_limit) or (
                    isinstance(raw_limit, str) and raw_limit.strip() != str(parsed_limit)
                ):
                    self._send_json(400, {"ok": False, "error": "Fast game turn limit must be a whole number of minutes between 1 and 12."})
                    return
                if parsed_limit < 1 or parsed_limit > 12:
                    self._send_json(400, {"ok": False, "error": "Fast game turn limit must be between 1 and 12 minutes."})
                    return
                turn_time_limit_minutes = parsed_limit

            start_immediately = bool(body.get("startImmediately", False))
            raw_invite_mode = str(body.get("inviteMode", "open")).strip().lower()
            invite_mode = "open" if start_immediately else ("invite_only" if raw_invite_mode == "invite_only" else "open")

            invited_users: List[Dict[str, Any]] = []
            if not start_immediately and invite_mode == "invite_only":
                if not check_rate_limit(f"invite:{user['id']}", 20, 60.0):
                    self._send_json(429, {"ok": False, "error": "Too many invite requests. Please wait a minute."})
                    return
                if 1 + bot_count >= max_players:
                    self._send_json(
                        400,
                        {
                            "ok": False,
                            "error": "Increase Maximum Players or reduce AI Bot Opponents so invited human players have at least one open seat.",
                        },
                    )
                    return
                parsed_unames, p_err = store.parse_invited_usernames(body.get("invitedUsernames"))
                if p_err:
                    self._send_json(400, {"ok": False, "error": p_err})
                    return
                if not parsed_unames:
                    self._send_json(
                        400,
                        {"ok": False, "error": "Please enter at least one player's username to invite for an Invite-Only game."},
                    )
                    return
                resolved_invites, r_err = store.resolve_users_by_usernames(parsed_unames, exclude_user_id=user["id"])
                if r_err:
                    self._send_json(400, {"ok": False, "error": r_err})
                    return
                if not resolved_invites:
                    self._send_json(
                        400,
                        {"ok": False, "error": "Please invite at least one other player's username (not just your own)."},
                    )
                    return
                invited_users = resolved_invites

            req_strategies = body.get("botStrategies")
            req_difficulties = body.get("botDifficulties")
            default_diff = game_engine.normalize_bot_difficulty(body.get("botDifficulty"), "ionic")
            persona_by_strategy = {p["strategy"]: p for p in game_engine.BOT_PERSONAS}

            initial_bots = []
            for i in range(bot_count):
                chosen_strat = None
                if isinstance(req_strategies, list) and i < len(req_strategies):
                    cand_s = str(req_strategies[i] or "").strip()
                    if cand_s in persona_by_strategy:
                        chosen_strat = cand_s
                if chosen_strat:
                    persona = dict(persona_by_strategy[chosen_strat])
                else:
                    persona = dict(game_engine.BOT_PERSONAS[i % len(game_engine.BOT_PERSONAS)])
                cand_diff = default_diff
                if isinstance(req_difficulties, list) and i < len(req_difficulties):
                    cand_diff = game_engine.normalize_bot_difficulty(req_difficulties[i], default_diff)
                persona["difficulty"] = cand_diff
                persona["botDifficulty"] = cand_diff
                initial_bots.append(persona)

            summary = store.create_game_lobby(
                user,
                name,
                max_players,
                initial_bots,
                invite_mode=invite_mode,
                invited_users=invited_users,
                speed_mode=speed_mode,
                turn_time_limit_minutes=turn_time_limit_minutes,
            )
            game_id = summary["id"]

            if start_immediately and len(summary.get("seats", [])) >= 2:
                players_config = [
                    {
                        "userId": s["userId"],
                        "name": s["name"],
                        "color": s["color"],
                        "isBot": s["isBot"],
                        "botStrategy": s.get("botStrategy") or "balanced",
                        "botDifficulty": s.get("botDifficulty") or "ionic",
                    }
                    for s in summary["seats"]
                ]
                state = game_engine.create_initial_game_state(
                    players_config,
                    speed_mode=summary.get("speedMode", speed_mode),
                    turn_time_limit_minutes=summary.get("turnTimeLimitMinutes", turn_time_limit_minutes),
                )
                state["hostUserId"] = summary.get("hostUserId", user["id"])
                store.save_game_state(game_id, state)
                summary = store.get_game_summary(game_id, viewer_user=user) or summary
                sanitized = _sanitize_for_user(state, user["id"], summary)
                self._send_json(201, {"ok": True, "summary": summary, "state": sanitized})
                return

            email_dispatch = None
            if invited_users:
                email_dispatch = email_service.send_game_invite_emails(summary, user, invited_users)

            self._send_json(
                201,
                {
                    "ok": True,
                    "summary": summary,
                    "state": None,
                    "emailDispatch": email_dispatch,
                },
            )
            return

        m_action = re.match(
            r"^/api/games/([a-f0-9]{6,24})/(join|invite|add-bot|update-bot|remove-seat|remove-player|chat|start|action|terminate)$",
            path,
        )
        if m_action:
            user = self._require_auth(require_csrf=True)
            if not user:
                return
            game_id, subcmd = m_action.group(1), m_action.group(2)
            lock = get_game_lock(game_id)
            with lock:
                if subcmd == "terminate":
                    ok, msg = store.terminate_game(game_id, user)
                    games = store.list_games(limit=30, viewer_user=user) if ok else None
                    self._send_json(
                        200 if ok else 403,
                        {"ok": ok, "message": msg, "error": None if ok else msg, "games": games},
                    )
                    return

                if subcmd == "join":
                    ok, msg = store.join_game_lobby(game_id, user, body.get("color"))
                    summary = store.get_game_summary(game_id, viewer_user=user)
                    status_code = 200 if ok else (403 if "Invite-Only" in msg else 400)
                    self._send_json(
                        status_code,
                        {"ok": ok, "message": msg, "error": None if ok else msg, "summary": summary},
                    )
                    return

                if subcmd == "invite":
                    if not check_rate_limit(f"invite:{user['id']}", 20, 60.0):
                        self._send_json(429, {"ok": False, "error": "Too many invite requests. Please wait a minute."})
                        return
                    parsed_unames, p_err = store.parse_invited_usernames(body.get("usernames"))
                    if p_err or not parsed_unames:
                        self._send_json(
                            400,
                            {"ok": False, "error": p_err or "Please enter at least one username to invite."},
                        )
                        return
                    resolved_invites, r_err = store.resolve_users_by_usernames(parsed_unames, exclude_user_id=user["id"])
                    if r_err or not resolved_invites:
                        self._send_json(
                            400,
                            {"ok": False, "error": r_err or "Please enter at least one other player's username."},
                        )
                        return
                    ok, msg, newly_invited = store.invite_players_to_lobby(game_id, user, resolved_invites)
                    summary = store.get_game_summary(game_id, viewer_user=user)
                    email_dispatch = None
                    if ok and newly_invited and summary:
                        email_dispatch = email_service.send_game_invite_emails(summary, user, newly_invited)
                    self._send_json(
                        200 if ok else 400,
                        {
                            "ok": ok,
                            "message": msg,
                            "error": None if ok else msg,
                            "summary": summary,
                            "emailDispatch": email_dispatch,
                        },
                    )
                    return

                if subcmd == "add-bot":
                    persona_by_strategy = {p["strategy"]: p for p in game_engine.BOT_PERSONAS}
                    req_strat = str(body.get("strategy", "")).strip()
                    if req_strat in persona_by_strategy:
                        bot_info = dict(persona_by_strategy[req_strat])
                    else:
                        persona_idx = int(body.get("personaIndex", 0)) % len(game_engine.BOT_PERSONAS)
                        bot_info = dict(game_engine.BOT_PERSONAS[persona_idx])
                    req_diff = game_engine.normalize_bot_difficulty(
                        body.get("difficulty") or body.get("botDifficulty"),
                        "ionic",
                    )
                    bot_info["difficulty"] = req_diff
                    bot_info["botDifficulty"] = req_diff
                    ok, msg = store.add_bot_to_lobby(game_id, user["id"], bot_info)
                    summary = store.get_game_summary(game_id, viewer_user=user)
                    status_code = 200 if ok else (403 if "Only the lobby host" in msg else 400)
                    self._send_json(status_code, {"ok": ok, "message": msg, "error": None if ok else msg, "summary": summary})
                    return

                if subcmd == "update-bot":
                    try:
                        seat_idx = int(body.get("seatIndex", -1))
                    except (TypeError, ValueError):
                        seat_idx = -1
                    req_strat = str(body.get("strategy", "balanced")).strip()
                    persona_by_strategy = {p["strategy"]: p for p in game_engine.BOT_PERSONAS}
                    bot_info = dict(persona_by_strategy.get(req_strat, game_engine.BOT_PERSONAS[0]))
                    req_diff = game_engine.normalize_bot_difficulty(
                        body.get("difficulty") or body.get("botDifficulty"),
                        "ionic",
                    )
                    bot_info["difficulty"] = req_diff
                    bot_info["botDifficulty"] = req_diff
                    ok, msg = store.update_lobby_bot_seat(game_id, user["id"], seat_idx, bot_info)
                    summary = store.get_game_summary(game_id, viewer_user=user)
                    status_code = 200 if ok else (403 if "Only the lobby host" in msg else 400)
                    self._send_json(status_code, {"ok": ok, "message": msg, "error": None if ok else msg, "summary": summary})
                    return

                if subcmd == "remove-seat":
                    try:
                        seat_idx = int(body.get("seatIndex", -1))
                    except (TypeError, ValueError):
                        seat_idx = -1
                    ok, msg = store.remove_seat_from_lobby(game_id, user["id"], seat_idx)
                    summary = store.get_game_summary(game_id, viewer_user=user)
                    status_code = 200 if ok else (403 if "Only the lobby host" in msg else 400)
                    self._send_json(status_code, {"ok": ok, "message": msg, "error": None if ok else msg, "summary": summary})
                    return

                if subcmd == "remove-player":
                    resolved = _apply_fast_timeouts_locked(store, game_id, viewer_user=user)
                    if not resolved:
                        self._send_json(404, {"ok": False, "error": "Game not found."})
                        return
                    summary, state, _kicked = resolved
                    is_creator = summary.get("hostUserId") == user["id"]
                    is_admin = bool(user.get("isAdmin"))
                    if not is_creator and not is_admin:
                        self._send_json(
                            403,
                            {"ok": False, "error": "Only the game creator or an administrator can remove players from an active game."},
                        )
                        return
                    if summary.get("status") != "active" or not state or "players" not in state or state.get("phase") == "finished":
                        self._send_json(400, {"ok": False, "error": "Players can only be replaced mid-game while the match is active."})
                        return

                    target_idx: Optional[int] = None
                    if "playerIndex" in body and body.get("playerIndex") is not None:
                        try:
                            target_idx = int(body.get("playerIndex"))
                        except (TypeError, ValueError):
                            target_idx = None
                    elif "userId" in body and body.get("userId") is not None:
                        try:
                            target_uid = int(body.get("userId"))
                        except (TypeError, ValueError):
                            target_uid = None
                        if target_uid is not None:
                            for pl in state.get("players", []):
                                if not pl.get("isBot") and pl.get("userId") == target_uid:
                                    target_idx = int(pl["index"])
                                    break

                    if target_idx is None or not (0 <= target_idx < len(state.get("players", []))):
                        self._send_json(400, {"ok": False, "error": "Valid playerIndex is required."})
                        return

                    reason = (
                        "left table to spectate"
                        if state["players"][target_idx].get("userId") == user["id"]
                        else "removed by host"
                    )
                    ok, msg = game_engine.replace_human_with_ionic_bot(state, target_idx, reason=reason, run_bots=True)
                    if ok:
                        store.save_game_state(game_id, state, was_Already_Finished=False)
                    updated_summary = store.get_game_summary(game_id, viewer_user=user)
                    sanitized = _sanitize_for_user(state, user["id"], updated_summary)
                    self._send_json(
                        200 if ok else 400,
                        {"ok": ok, "message": msg, "error": None if ok else msg, "summary": updated_summary, "state": sanitized},
                    )
                    return

                if subcmd == "chat":
                    resolved = _apply_fast_timeouts_locked(store, game_id, viewer_user=user)
                    if not resolved:
                        self._send_json(404, {"ok": False, "error": "Game not found."})
                        return
                    summary, state, _kicked = resolved
                    if not state or "players" not in state:
                        self._send_json(400, {"ok": False, "error": "Game chat is available once the match starts."})
                        return

                    seated_player = next(
                        (p for p in state.get("players", []) if not p.get("isBot") and p.get("userId") == user["id"]),
                        None,
                    )
                    is_creator = summary.get("hostUserId") == user["id"]
                    is_admin = bool(user.get("isAdmin"))
                    if not seated_player and not is_creator and not is_admin:
                        self._send_json(
                            403,
                            {"ok": False, "error": "Only seated players, the game creator, or an administrator may chat in this match."},
                        )
                        return

                    raw_msg = body.get("message")
                    if raw_msg is None:
                        self._send_json(400, {"ok": False, "error": "Chat message cannot be empty."})
                        return
                    cleaned_msg = " ".join(ch for ch in "".join(c for c in str(raw_msg) if ord(c) >= 32 and ord(c) != 127).split()).strip()
                    if not cleaned_msg:
                        self._send_json(400, {"ok": False, "error": "Chat message cannot be empty."})
                        return
                    if len(cleaned_msg) > 300:
                        self._send_json(400, {"ok": False, "error": "Chat message must be 300 characters or fewer."})
                        return

                    if seated_player:
                        sender_name = str(seated_player.get("name") or user.get("displayName") or "Merchant")
                        sender_color = seated_player.get("color")
                        is_spectator = False
                    else:
                        sender_name = str(user.get("displayName") or user.get("username") or "Spectator")
                        sender_color = user.get("preferredColor")
                        is_spectator = True

                    entry = game_engine.add_chat_log(
                        state,
                        sender_name=sender_name,
                        sender_color=sender_color,
                        message=cleaned_msg,
                        is_spectator=is_spectator,
                        user_id=user["id"],
                    )
                    if not entry:
                        self._send_json(400, {"ok": False, "error": "Chat message cannot be empty."})
                        return

                    # Persist only state JSON so chat never resets turn inactivity timers
                    store.update_game_state_json(game_id, state)
                    sanitized = _sanitize_for_user(state, user["id"], summary)
                    self._send_json(200, {"ok": True, "chatEntry": entry, "summary": summary, "state": sanitized})
                    return

                if subcmd == "start":
                    summary = store.get_game_summary(game_id, viewer_user=user)
                    if not summary:
                        self._send_json(404, {"ok": False, "error": "Game not found."})
                        return
                    if summary.get("hostUserId") != user["id"] and not user.get("isAdmin"):
                        self._send_json(403, {"ok": False, "error": "Only the lobby host can start the match."})
                        return
                    if summary["status"] != "lobby":
                        self._send_json(400, {"ok": False, "error": "Game has already started."})
                        return
                    if len(summary["seats"]) < 2:
                        self._send_json(400, {"ok": False, "error": "At least 2 players (human or AI bot) are required to start."})
                        return
                    players_config = [
                        {
                            "userId": s["userId"],
                            "name": s["name"],
                            "color": s["color"],
                            "isBot": s["isBot"],
                            "botStrategy": s.get("botStrategy") or "balanced",
                            "botDifficulty": s.get("botDifficulty") or "ionic",
                        }
                        for s in summary["seats"]
                    ]
                    state = game_engine.create_initial_game_state(
                        players_config,
                        speed_mode=summary.get("speedMode", "normal"),
                        turn_time_limit_minutes=summary.get("turnTimeLimitMinutes"),
                    )
                    state["hostUserId"] = summary.get("hostUserId", user["id"])
                    store.save_game_state(game_id, state)
                    updated_summary = store.get_game_summary(game_id, viewer_user=user)
                    sanitized = _sanitize_for_user(state, user["id"], updated_summary)
                    self._send_json(200, {"ok": True, "message": "Match started!", "summary": updated_summary, "state": sanitized})
                    return

                if subcmd == "action":
                    full = store.get_game_full(game_id, viewer_user=user)
                    if not full:
                        self._send_json(404, {"ok": False, "error": "Game not found."})
                        return
                    summary, state = full
                    if not state or "players" not in state:
                        self._send_json(400, {"ok": False, "error": "Game has not started yet."})
                        return
                    was_finished = summary["status"] == "finished"
                    state.setdefault("hostUserId", summary.get("hostUserId"))
                    state["speedMode"] = summary.get("speedMode", state.get("speedMode", "normal"))
                    state["turnTimeLimitMinutes"] = summary.get("turnTimeLimitMinutes", state.get("turnTimeLimitMinutes"))

                    kicked = game_engine.process_fast_timeouts(state) if not was_finished else []

                    if body.get("type") == "spectator_step":
                        is_creator = summary.get("hostUserId") == user["id"]
                        is_admin = bool(user.get("isAdmin"))
                        if not is_creator and not is_admin:
                            if kicked:
                                store.save_game_state(game_id, state, was_Already_Finished=was_finished)
                            self._send_json(
                                403,
                                {"ok": False, "error": "Only the game creator or an administrator can advance an all-AI match."},
                            )
                            return

                    human_uids = [
                        p["userId"]
                        for p in state.get("players", [])
                        if not p.get("isBot") and p.get("userId") is not None
                    ]
                    allow_undo_map = store.get_users_allow_undo_map(human_uids)
                    ok, msg = game_engine.handle_player_action(state, user["id"], body, allow_undo_map=allow_undo_map)
                    if ok or kicked:
                        store.save_game_state(game_id, state, was_Already_Finished=was_finished)
                    updated_summary = store.get_game_summary(game_id, viewer_user=user)
                    sanitized = _sanitize_for_user(state, user["id"], updated_summary)
                    fresh_user = store.get_user_by_id(user["id"])
                    self._send_json(
                        200 if ok else 400,
                        {
                            "ok": ok,
                            "message": msg,
                            "error": None if ok else msg,
                            "summary": updated_summary,
                            "state": sanitized,
                            "user": fresh_user,
                        },
                    )
                    return

        self._send_json(404, {"ok": False, "error": "Unknown API endpoint."})

    def do_PUT(self) -> None:
        self._send_json(405, {"ok": False, "error": "Method not allowed."})

    def do_DELETE(self) -> None:
        self._send_json(405, {"ok": False, "error": "Method not allowed."})

    def do_PATCH(self) -> None:
        self._send_json(405, {"ok": False, "error": "Method not allowed."})


def run_server(host: str = "127.0.0.1", port: int = 8080) -> None:
    store = storage.get_backend()
    store.init_db()
    # Strictly enforce 127.0.0.1 loopback in local development and tests;
    # only bind container interface when running inside managed Cloud Run (K_SERVICE).
    is_cloud_run = bool(
        os.getenv("K_SERVICE", "").strip()
        or os.getenv("NIGHTMERCHANT_CLOUD_RUN", "").strip() == "1"
    )
    if is_cloud_run:
        bind_host = host
    else:
        bind_host = "127.0.0.1"
    httpd = ThreadingHTTPServer((bind_host, port), NightMerchantHandler)
    stop_event = threading.Event()

    def _fast_timeout_loop() -> None:
        while not stop_event.wait(5.0):
            _sweep_due_fast_games(store)

    sweeper = threading.Thread(target=_fast_timeout_loop, name="FastTimeoutSweeper", daemon=True)
    sweeper.start()
    print(f"Night Merchant: All Roads Lead to Rome (211 A.D.) server listening on http://{bind_host}:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop_event.set()
        httpd.server_close()


if __name__ == "__main__":
    port_num = int(os.getenv("PORT") or os.getenv("NIGHTMERCHANT_PORT", "8080"))
    in_container = bool(
        os.getenv("K_SERVICE", "").strip()
        or os.getenv("NIGHTMERCHANT_CLOUD_RUN", "").strip() == "1"
    )
    default_host = "" if in_container else "127.0.0.1"
    run_server(default_host, port_num)
