# Copyright (c) 2026 Dashiell Renaud (https://dashiellrenaud.com)
# Licensed under Creative Commons Attribution-NonCommercial-NoDerivatives 4.0
# International (CC BY-NC-ND 4.0): https://creativecommons.org/licenses/by-nc-nd/4.0/
# SPDX-License-Identifier: CC-BY-NC-ND-4.0

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from typing import Any, Dict, List, Optional, Tuple

DB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DB_PATH = os.path.join(DB_DIR, "nightmerchant.db")

SESSION_TTL_SECONDS = 60 * 60 * 12  # 12-hour finite session expiration


def parse_invited_usernames(raw_usernames: Any) -> Tuple[List[str], Optional[str]]:
    """Normalize and validate a list or comma/whitespace-delimited string of usernames."""
    if raw_usernames is None:
        return [], None
    tokens: List[str] = []
    if isinstance(raw_usernames, str):
        tokens = [t for t in re.split(r"[\s,;]+", raw_usernames.strip()) if t]
    elif isinstance(raw_usernames, list):
        for item in raw_usernames:
            if isinstance(item, str):
                tokens.extend(t for t in re.split(r"[\s,;]+", item.strip()) if t)
    else:
        return [], "Invited usernames must be provided as a list or comma-separated string."

    cleaned: List[str] = []
    seen = set()
    for tok in tokens:
        uname = tok.lstrip("@").strip().lower()
        if not uname:
            continue
        if len(uname) < 3 or len(uname) > 32 or not all(c.isalnum() or c in "_-." for c in uname):
            return [], f"Invalid username format: '{tok}'. Usernames are 3–32 letters, numbers, '_', '-', or '.'."
        if uname not in seen:
            seen.add(uname)
            cleaned.append(uname)
    if len(cleaned) > 20:
        return [], "Cannot invite more than 20 usernames to a single lobby."
    return cleaned, None



def _resolve_db_path() -> Tuple[str, str]:
    override = os.getenv("NIGHTMERCHANT_DB_PATH", "").strip()
    if override:
        abs_path = os.path.abspath(override)
        return os.path.dirname(abs_path), abs_path
    return DB_DIR, DB_PATH


def get_secret_key() -> str:
    """Multi-tiered secret resolution without hardcoded literal fallbacks."""
    env_secret = os.getenv("NIGHTMERCHANT_SECRET_KEY")
    if env_secret:
        return env_secret
    db_dir, _ = _resolve_db_path()
    secret_file = os.path.join(db_dir, ".session_secret")
    if os.path.exists(secret_file):
        with open(secret_file, "r", encoding="utf-8") as fh:
            val = fh.read().strip()
            if val:
                return val
    # Ephemeral fallback for local sandbox/testing
    os.makedirs(db_dir, exist_ok=True)
    generated = secrets.token_hex(32)
    try:
        with open(secret_file, "w", encoding="utf-8") as fh:
            fh.write(generated)
        os.chmod(secret_file, 0o600)
    except OSError:
        pass
    return generated


def get_connection() -> sqlite3.Connection:
    db_dir, db_path = _resolve_db_path()
    os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


ALL_CART_COLORS: List[str] = [
    "Ruby",
    "Cobalt",
    "Emerald",
    "Gold",
    "Amethyst",
    "Sapphire",
    "Z1",  # #4A5FD4 (Cobalt Blue)
    "Z2",  # #D4FF5E (Lime Green)
    "Z3",  # #EBA439 (Amber Orange)
    "Z4",  # #D89CB0 (Rose Pink)
    "Z5",  # #9CA14B (Citron Yellow-Green)
    "Z6",  # #862D25 (Russet)
    "Z7",  # #49884B (Kelly Green)
    "Z8",  # #6F5E8B (Dusky Violet)
    "Z9",  # #5BC8FA (Light Sky Blue)
    "Z10", # #795548 (Chestnut Brown)
    "Z11", # #C589CF (Lavender)
    "Z12", # #9E9E9E (Ash Silver)
]

LEGACY_COLOR_MAP: Dict[str, str] = {
    "Red": "Ruby",
    "Blue": "Cobalt",
    "Green": "Emerald",
    "Yellow": "Gold",
    "Purple": "Amethyst",
    "Cyan": "Sapphire",
}


def normalize_cart_color(color: Optional[str], default: str = "Ruby") -> str:
    if not color:
        return default
    if color in ALL_CART_COLORS:
        return color
    return LEGACY_COLOR_MAP.get(color, default)


BOT_DIFFICULTIES: Tuple[str, ...] = ("doric", "ionic", "corinthian")


def normalize_bot_difficulty(raw: Any, default: str = "ionic") -> str:
    val = str(raw or "").strip().lower()
    if val in ("doric", "easy"):
        return "doric"
    if val in ("ionic", "medium"):
        return "ionic"
    if val in ("corinthian", "hard"):
        return "corinthian"
    return default if default in BOT_DIFFICULTIES else "ionic"


def normalize_speed_mode(raw: Any) -> str:
    val = str(raw or "").strip().lower()
    return "fast" if val == "fast" else "normal"


def normalize_turn_time_limit_minutes(raw: Any, speed_mode: str = "normal") -> Optional[int]:
    if normalize_speed_mode(speed_mode) != "fast":
        return None
    if raw is None or raw == "":
        return 6
    try:
        val = int(raw)
    except (TypeError, ValueError):
        return 6
    return max(1, min(12, val))


def compute_next_timeout_at(
    state: Dict[str, Any],
    speed_mode: str,
    limit_minutes: Optional[int],
    status: str = "active",
) -> Optional[int]:
    if status != "active" or normalize_speed_mode(speed_mode) != "fast":
        return None
    lim = normalize_turn_time_limit_minutes(limit_minutes, "fast")
    if not lim:
        return None
    waiting = state.get("turnWaitingSince")
    if not isinstance(waiting, dict) or not waiting:
        return None
    deadlines: List[int] = []
    for ts in waiting.values():
        if ts is not None:
            try:
                deadlines.append(int(ts) + lim * 60)
            except (TypeError, ValueError):
                pass
    return min(deadlines) if deadlines else None


def validate_email(email: str) -> Optional[str]:
    if not isinstance(email, str):
        return "Email address is required."
    clean = email.strip().lower()
    if not clean:
        return "Email address is required."
    if len(clean) < 5 or len(clean) > 120 or "@" not in clean:
        return "Please enter a valid email address."
    local_part, _, domain_part = clean.partition("@")
    if not local_part or not domain_part or "." not in domain_part:
        return "Please enter a valid email address (e.g. merchant@roma.it)."
    if any(c.isspace() for c in clean):
        return "Email address must not contain spaces."
    return None


def mask_email(email: Optional[str]) -> str:
    if not email or "@" not in email:
        return ""
    local_part, _, domain_part = email.partition("@")
    if len(local_part) <= 2:
        masked_local = local_part[0] + "***"
    else:
        masked_local = local_part[0] + "***" + local_part[-1]
    return f"{masked_local}@{domain_part}"


DEFAULT_HOTKEYS: Dict[str, str] = {
    "moveToTile": "v",
    "scoutTile": "s",
    "scoutDeck": "d",
    "endTurn": "e",
    "closeModal": "x",
    "toggleCartNav": "n",
    "viewRomeBoard": "r",
    "viewMarketBoard": "m",
    "viewClimateBoard": "c",
    "viewAllBoards": "b",
}

DEFAULT_USER_SETTINGS: Dict[str, Any] = {
    "defaultBoardView": "auto",
    "autoPromptCargoLoad": True,
    "animateDice": True,
    "paceBotTurns": True,
    "soundEffects": True,
    "confirmEndTurn": False,
    "allowUndoByDefault": False,
    "skipMissionCompletionPopups": False,
    "hotkeys": dict(DEFAULT_HOTKEYS),
}


def sanitize_hotkeys_dict(raw_hotkeys: Any) -> Dict[str, str]:
    merged = dict(DEFAULT_HOTKEYS)
    if isinstance(raw_hotkeys, dict):
        for hk_name in DEFAULT_HOTKEYS:
            val = raw_hotkeys.get(hk_name)
            if isinstance(val, str):
                clean_k = val.strip().lower()[:1]
                merged[hk_name] = clean_k
    return merged


def _parse_user_settings(raw_json: Optional[str]) -> Dict[str, Any]:
    merged = dict(DEFAULT_USER_SETTINGS)
    merged["hotkeys"] = dict(DEFAULT_HOTKEYS)
    if raw_json:
        try:
            parsed = json.loads(raw_json)
            if isinstance(parsed, dict):
                for k in DEFAULT_USER_SETTINGS:
                    if k == "hotkeys":
                        merged["hotkeys"] = sanitize_hotkeys_dict(parsed.get("hotkeys"))
                    elif k in parsed:
                        merged[k] = parsed[k]
        except Exception:
            pass
    return merged


def _admin_usernames() -> set:
    return {
        u.strip().lower()
        for u in os.environ.get("NIGHTMERCHANT_ADMINS", "").split(",")
        if u.strip()
    }


def validate_permanent_username(username: Any) -> Tuple[str, Optional[str]]:
    if not isinstance(username, str):
        return "", "Please enter a valid username."
    clean = username.strip()
    while clean.startswith("@"):
        clean = clean[1:].strip()
    clean = clean.lower()
    if len(clean) < 3 or len(clean) > 32:
        return "", "Username must be between 3 and 32 characters."
    if not clean[0].isalnum() or not all(c.isascii() and (c.isalnum() or c in "_-.") for c in clean):
        return "", "Username must start with a letter or number and contain only letters, numbers, underscores (_), hyphens (-), or periods (.)."
    if clean.startswith("pending_"):
        return "", "Usernames may not start with 'pending_'."
    if clean == "mercator_romanus":
        return "", "That username is reserved."
    return clean, None


def _format_user_dict(row: sqlite3.Row, csrf_token: Optional[str] = None) -> Dict[str, Any]:
    keys = row.keys()
    email_val = row["email"] if "email" in keys and row["email"] else f"{row['username']}@roma.local"
    provider_val = row["auth_provider"] if "auth_provider" in keys and row["auth_provider"] else "local"
    settings_raw = row["settings_json"] if "settings_json" in keys else "{}"
    uname_lower = str(row["username"]).lower()
    admin_set = _admin_usernames()
    if uname_lower == "mercator_romanus" and "mercator_romanus" not in admin_set:
        is_admin_val = False
    elif "is_admin" in keys and row["is_admin"] is not None:
        is_admin_val = bool(row["is_admin"]) or (uname_lower in admin_set)
    else:
        is_admin_val = uname_lower in admin_set
    needs_uname_val = (
        bool(row["needs_username_setup"])
        if "needs_username_setup" in keys and row["needs_username_setup"] is not None
        else False
    )
    res: Dict[str, Any] = {
        "id": row["id"],
        "username": row["username"],
        "displayName": row["display_name"],
        "email": email_val,
        "maskedEmail": mask_email(email_val),
        "authProvider": provider_val,
        "preferredColor": normalize_cart_color(row["preferred_color"], "Z1"),
        "settings": _parse_user_settings(settings_raw),
        "isAdmin": is_admin_val,
        "needsUsernameSetup": needs_uname_val,
        "gamesPlayed": row["games_played"],
        "gamesWon": row["games_won"],
        "bestWealth": row["best_wealth"],
    }
    if csrf_token is not None:
        res["csrfToken"] = csrf_token
    return res


def init_db() -> None:
    conn = get_connection()
    try:
        with conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    email TEXT UNIQUE,
                    google_sub TEXT UNIQUE,
                    auth_provider TEXT NOT NULL DEFAULT 'local',
                    display_name TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    password_salt TEXT NOT NULL,
                    preferred_color TEXT NOT NULL DEFAULT 'Z1',
                    settings_json TEXT NOT NULL DEFAULT '{}',
                    is_admin INTEGER NOT NULL DEFAULT 0,
                    needs_username_setup INTEGER NOT NULL DEFAULT 0,
                    games_played INTEGER NOT NULL DEFAULT 0,
                    games_won INTEGER NOT NULL DEFAULT 0,
                    best_wealth INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL
                )
                """
            )
            # Safe schema migrations for existing databases
            existing_cols = {
                r["name"] for r in conn.execute("PRAGMA table_info(users)").fetchall()
            }
            if "email" not in existing_cols:
                conn.execute("ALTER TABLE users ADD COLUMN email TEXT")
                conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)")
            if "google_sub" not in existing_cols:
                conn.execute("ALTER TABLE users ADD COLUMN google_sub TEXT")
                conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub)")
            if "auth_provider" not in existing_cols:
                conn.execute("ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'local'")
            if "settings_json" not in existing_cols:
                conn.execute("ALTER TABLE users ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'")
            if "is_admin" not in existing_cols:
                conn.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
            if "needs_username_setup" not in existing_cols:
                conn.execute("ALTER TABLE users ADD COLUMN needs_username_setup INTEGER NOT NULL DEFAULT 0")
            admin_usernames = sorted(_admin_usernames())
            if "mercator_romanus" not in admin_usernames:
                conn.execute("UPDATE users SET is_admin = 0 WHERE LOWER(username) = 'mercator_romanus'")
            if admin_usernames:
                placeholders = ",".join("?" for _ in admin_usernames)
                conn.execute(
                    f"UPDATE users SET is_admin = 1 WHERE LOWER(username) IN ({placeholders})",
                    admin_usernames,
                )

            # Backfill any existing users missing an email address
            rows_no_email = conn.execute("SELECT id, username FROM users WHERE email IS NULL OR email = ''").fetchall()
            for r in rows_no_email:
                fallback_email = f"{r['username']}@roma.local"
                conn.execute("UPDATE users SET email = ? WHERE id = ?", (fallback_email, r["id"]))

            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    csrf_token TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS games (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    host_user_id INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'lobby',
                    invite_mode TEXT NOT NULL DEFAULT 'open',
                    speed_mode TEXT NOT NULL DEFAULT 'normal',
                    turn_time_limit_minutes INTEGER,
                    next_timeout_at INTEGER,
                    max_players INTEGER NOT NULL DEFAULT 4,
                    season TEXT NOT NULL DEFAULT 'Spring',
                    phase TEXT NOT NULL DEFAULT 'Setup',
                    turn INTEGER NOT NULL DEFAULT 1,
                    state_json TEXT NOT NULL,
                    winner_name TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE CASCADE
                )
                """
            )
            game_cols = {
                r["name"] for r in conn.execute("PRAGMA table_info(games)").fetchall()
            }
            if "invite_mode" not in game_cols:
                conn.execute("ALTER TABLE games ADD COLUMN invite_mode TEXT NOT NULL DEFAULT 'open'")
            if "speed_mode" not in game_cols:
                conn.execute("ALTER TABLE games ADD COLUMN speed_mode TEXT NOT NULL DEFAULT 'normal'")
            if "turn_time_limit_minutes" not in game_cols:
                conn.execute("ALTER TABLE games ADD COLUMN turn_time_limit_minutes INTEGER")
            if "next_timeout_at" not in game_cols:
                conn.execute("ALTER TABLE games ADD COLUMN next_timeout_at INTEGER")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS game_invites (
                    game_id TEXT NOT NULL,
                    user_id INTEGER NOT NULL,
                    username TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    invited_at INTEGER NOT NULL,
                    PRIMARY KEY (game_id, user_id),
                    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS game_players (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    game_id TEXT NOT NULL,
                    seat_index INTEGER NOT NULL,
                    user_id INTEGER,
                    is_bot INTEGER NOT NULL DEFAULT 0,
                    bot_strategy TEXT,
                    bot_difficulty TEXT,
                    player_name TEXT NOT NULL,
                    player_color TEXT NOT NULL,
                    final_wealth INTEGER,
                    UNIQUE(game_id, seat_index),
                    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
                )
                """
            )
            gp_cols = {
                r["name"] for r in conn.execute("PRAGMA table_info(game_players)").fetchall()
            }
            if "bot_difficulty" not in gp_cols:
                conn.execute("ALTER TABLE game_players ADD COLUMN bot_difficulty TEXT")
                conn.execute("UPDATE game_players SET bot_difficulty = 'ionic' WHERE is_bot = 1 AND bot_difficulty IS NULL")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS completed_games (
                    game_id TEXT PRIMARY KEY,
                    game_name TEXT NOT NULL,
                    winner_name TEXT,
                    season TEXT NOT NULL DEFAULT 'Fall',
                    completed_at INTEGER NOT NULL,
                    standings_json TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS completed_game_players (
                    game_id TEXT NOT NULL,
                    seat_index INTEGER NOT NULL,
                    user_id INTEGER,
                    is_bot INTEGER NOT NULL DEFAULT 0,
                    bot_difficulty TEXT,
                    player_name TEXT NOT NULL,
                    player_color TEXT NOT NULL,
                    final_wealth INTEGER NOT NULL DEFAULT 0,
                    rank INTEGER NOT NULL DEFAULT 1,
                    won INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (game_id, seat_index),
                    FOREIGN KEY (game_id) REFERENCES completed_games(game_id) ON DELETE CASCADE,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
                )
                """
            )
            cgp_cols = {
                r["name"] for r in conn.execute("PRAGMA table_info(completed_game_players)").fetchall()
            }
            if "bot_difficulty" not in cgp_cols:
                conn.execute("ALTER TABLE completed_game_players ADD COLUMN bot_difficulty TEXT")
                conn.execute("UPDATE completed_game_players SET bot_difficulty = 'ionic' WHERE is_bot = 1 AND bot_difficulty IS NULL")
            # Migrate any legacy faction-gem color names to the 12 Aravt Zodiac colors
            for old_c, new_c in LEGACY_COLOR_MAP.items():
                conn.execute("UPDATE users SET preferred_color = ? WHERE preferred_color = ?", (new_c, old_c))
                conn.execute("UPDATE game_players SET player_color = ? WHERE player_color = ?", (new_c, old_c))
                conn.execute("UPDATE completed_game_players SET player_color = ? WHERE player_color = ?", (new_c, old_c))

            # Backfill any currently finished games into completed_games
            finished_rows = conn.execute("SELECT * FROM games WHERE status = 'finished'").fetchall()
            for g_row in finished_rows:
                already = conn.execute(
                    "SELECT 1 FROM completed_games WHERE game_id = ?",
                    (g_row["id"],),
                ).fetchone()
                if not already:
                    try:
                        parsed_st = json.loads(g_row["state_json"] or "{}")
                    except Exception:
                        parsed_st = {}
                    if isinstance(parsed_st, dict) and parsed_st.get("players"):
                        _upsert_completed_game(
                            conn,
                            game_id=g_row["id"],
                            game_name=g_row["name"],
                            state=parsed_st,
                            completed_at=int(g_row["updated_at"] or int(time.time())),
                        )

            # One-time migration for historical terminated game that was double-counted after Undo
            existing_completed_cnt = conn.execute("SELECT COUNT(*) AS cnt FROM completed_games").fetchone()["cnt"]
            if existing_completed_cnt == 0:
                founder_row = conn.execute(
                    "SELECT id, display_name, games_played, games_won, best_wealth FROM users WHERE username = ? AND games_played = 2 AND games_won = 2 AND best_wealth = 500",
                    ("mercator_romanus",),
                ).fetchone()
                if founder_row:
                    hist_gid = "hist_211ad_01"
                    conn.execute(
                        """
                        INSERT INTO completed_games (game_id, game_name, winner_name, season, completed_at, standings_json)
                        VALUES (?, ?, ?, 'Fall', ?, NULL)
                        """,
                        (
                            hist_gid,
                            f"{founder_row['display_name']}'s Convivium",
                            founder_row["display_name"],
                            1793233307,
                        ),
                    )
                    hist_players = [
                        (hist_gid, 0, int(founder_row["id"]), 0, founder_row["display_name"], "Z3", 500, 1, 1),
                        (hist_gid, 1, None, 1, "Marcus Mercator", "Z1", 227, 2, 0),
                        (hist_gid, 2, None, 1, "Cornelia Severa", "Z7", 59, 3, 0),
                    ]
                    conn.executemany(
                        """
                        INSERT INTO completed_game_players (
                            game_id, seat_index, user_id, is_bot, player_name, player_color, final_wealth, rank, won
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        hist_players,
                    )

            _recompute_all_user_stats(conn)
    finally:
        conn.close()


def _upsert_completed_game(
    conn: sqlite3.Connection,
    game_id: str,
    game_name: str,
    state: Dict[str, Any],
    completed_at: int,
) -> List[int]:
    winner_name = state.get("winner")
    season = str(state.get("season") or "Fall")
    standings = state.get("finalStandings")
    standings_json = json.dumps(standings) if isinstance(standings, list) else None

    conn.execute(
        """
        INSERT INTO completed_games (game_id, game_name, winner_name, season, completed_at, standings_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(game_id) DO UPDATE SET
            game_name = excluded.game_name,
            winner_name = excluded.winner_name,
            season = excluded.season,
            completed_at = excluded.completed_at,
            standings_json = excluded.standings_json
        """,
        (game_id, game_name, winner_name, season, int(completed_at), standings_json),
    )

    conn.execute("DELETE FROM completed_game_players WHERE game_id = ?", (game_id,))

    rank_by_index: Dict[int, int] = {}
    won_by_index: Dict[int, bool] = {}
    if isinstance(standings, list):
        for s_item in standings:
            if isinstance(s_item, dict) and "playerIndex" in s_item:
                p_idx = int(s_item["playerIndex"])
                rank_by_index[p_idx] = int(s_item.get("rank", 1))
                won_by_index[p_idx] = bool(s_item.get("won", False))

    players = list(state.get("players", []))
    if not rank_by_index and players:
        sorted_p = sorted(
            players,
            key=lambda p: (
                1 if (winner_name and p.get("name") == winner_name) else 0,
                int(p.get("cash", 0)),
                -int(p.get("index", 0)),
            ),
            reverse=True,
        )
        prev_cash: Optional[int] = None
        prev_won = False
        prev_rank = 1
        for i, p in enumerate(sorted_p):
            p_idx = int(p.get("index", i))
            won_flag = bool(winner_name and p.get("name") == winner_name) if winner_name else (i == 0)
            c_val = int(p.get("cash", 0))
            if i == 0:
                rk = 1
            elif not won_flag and not prev_won and prev_cash is not None and c_val == prev_cash:
                rk = prev_rank
            else:
                rk = i + 1
            prev_cash = c_val
            prev_won = won_flag
            prev_rank = rk
            rank_by_index[p_idx] = rk
            won_by_index[p_idx] = won_flag

    affected_uids: List[int] = []
    for i, p in enumerate(players):
        seat_idx = int(p.get("index", i))
        uid = p.get("userId")
        if uid is not None:
            affected_uids.append(int(uid))
        is_bot = bool(p.get("isBot"))
        bot_diff = normalize_bot_difficulty(p.get("botDifficulty"), "ionic") if is_bot else None
        p_color = normalize_cart_color(p.get("color"), "Z3")
        c_val = int(p.get("cash", 0))
        rk = rank_by_index.get(seat_idx, i + 1)
        won_int = 1 if won_by_index.get(seat_idx, bool(winner_name and p.get("name") == winner_name)) else 0
        conn.execute(
            """
            INSERT INTO completed_game_players (
                game_id, seat_index, user_id, is_bot, bot_difficulty, player_name, player_color, final_wealth, rank, won
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                game_id,
                seat_idx,
                int(uid) if uid is not None else None,
                1 if is_bot else 0,
                bot_diff,
                str(p.get("name", f"Player {seat_idx + 1}")),
                p_color,
                c_val,
                rk,
                won_int,
            ),
        )
    return affected_uids


def _recompute_user_stats(conn: sqlite3.Connection, user_ids: List[int]) -> None:
    unique_uids = sorted({int(u) for u in user_ids if u is not None})
    for uid in unique_uids:
        agg = conn.execute(
            """
            SELECT
                COUNT(DISTINCT game_id) AS games_played,
                COUNT(DISTINCT CASE WHEN won = 1 THEN game_id END) AS games_won,
                COALESCE(MAX(final_wealth), 0) AS best_wealth
            FROM completed_game_players
            WHERE user_id = ?
            """,
            (uid,),
        ).fetchone()
        conn.execute(
            """
            UPDATE users
            SET games_played = ?,
                games_won = ?,
                best_wealth = ?
            WHERE id = ?
            """,
            (
                int(agg["games_played"] or 0),
                int(agg["games_won"] or 0),
                int(agg["best_wealth"] or 0),
                uid,
            ),
        )


def _recompute_all_user_stats(conn: sqlite3.Connection) -> None:
    uids = [int(r["id"]) for r in conn.execute("SELECT id FROM users").fetchall()]
    _recompute_user_stats(conn, uids)


def validate_password_strength(password: str) -> Optional[str]:
    """
    Validate password strength per security guidelines:
    - Minimum 8 characters (12+ recommended)
    - Maximum 128 characters
    - Allow all characters including special characters
    # TODO(security): Integrate leaked password detection (e.g. HaveIBeenPwned k-anonymity check) in production.
    # TODO(security): Add optional OAuth 2.0 / OIDC provider login and MFA support for production deployment.
    """
    if not isinstance(password, str):
        return "Password must be a valid string."
    if len(password) < 8:
        return "Password must be at least 8 characters long."
    if len(password) > 128:
        return "Password must not exceed 128 characters."
    return None


def _hash_password(password: str, salt_hex: str) -> str:
    salt = bytes.fromhex(salt_hex)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310000)
    return dk.hex()


def _hash_session_token(raw_token: str) -> str:
    secret = get_secret_key().encode("utf-8")
    return hmac.new(secret, raw_token.encode("utf-8"), hashlib.sha256).hexdigest()


def create_user(
    username: str,
    display_name: str,
    password: str,
    preferred_color: str = "Z1",
    email: str = "",
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    username_clean = username.strip().lower()
    display_clean = display_name.strip()
    email_clean = email.strip().lower() if isinstance(email, str) else ""

    if not username_clean or len(username_clean) < 3 or len(username_clean) > 32:
        return None, "Username must be between 3 and 32 characters."
    if not all(c.isalnum() or c in "_-." for c in username_clean):
        return None, "Username may only contain letters, numbers, underscores, hyphens, or periods."
    if not display_clean or len(display_clean) > 40:
        return None, "Display name must be between 1 and 40 characters."

    email_err = validate_email(email_clean)
    if email_err:
        return None, email_err

    pw_err = validate_password_strength(password)
    if pw_err:
        return None, pw_err

    clean_color = normalize_cart_color(preferred_color, "Z1")
    salt_hex = secrets.token_hex(16)
    pw_hash = _hash_password(password, salt_hex)
    now = int(time.time())
    default_settings_json = json.dumps(DEFAULT_USER_SETTINGS)

    conn = get_connection()
    try:
        with conn:
            existing_u = conn.execute("SELECT id FROM users WHERE username = ?", (username_clean,)).fetchone()
            if existing_u:
                return None, "That username is already registered."
            existing_e = conn.execute("SELECT id FROM users WHERE email = ?", (email_clean,)).fetchone()
            if existing_e:
                return None, "That email address is already tied to an account."

            is_admin_flag = 1 if username_clean in _admin_usernames() else 0
            cur = conn.execute(
                """
                INSERT INTO users (
                    username, email, auth_provider, display_name,
                    password_hash, password_salt, preferred_color, settings_json, is_admin, created_at
                )
                VALUES (?, ?, 'local', ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    username_clean,
                    email_clean,
                    display_clean,
                    pw_hash,
                    salt_hex,
                    clean_color,
                    default_settings_json,
                    is_admin_flag,
                    now,
                ),
            )
            user_id = cur.lastrowid
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return _format_user_dict(row), None
    except sqlite3.IntegrityError:
        return None, "That username or email address is already registered."
    finally:
        conn.close()


def get_or_create_local_demo_user() -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Fetch or create the local-only non-admin sandbox account ('mercator_romanus')
    using a random secret password hash (never hardcoded).
    """
    conn = get_connection()
    try:
        with conn:
            row = conn.execute("SELECT * FROM users WHERE username = ?", ("mercator_romanus",)).fetchone()
            if row:
                if "mercator_romanus" not in _admin_usernames() and int(row["is_admin"] or 0) != 0:
                    conn.execute("UPDATE users SET is_admin = 0 WHERE id = ?", (row["id"],))
                    row = conn.execute("SELECT * FROM users WHERE id = ?", (row["id"],)).fetchone()
                return _format_user_dict(row), None

            salt_hex = secrets.token_hex(16)
            pw_hash = _hash_password(secrets.token_urlsafe(24), salt_hex)
            now = int(time.time())
            default_settings_json = json.dumps(DEFAULT_USER_SETTINGS)
            cur = conn.execute(
                """
                INSERT INTO users (
                    username, email, auth_provider, display_name,
                    password_hash, password_salt, preferred_color, settings_json, is_admin, created_at
                )
                VALUES (?, ?, 'local', ?, ?, ?, 'Z3', ?, 0, ?)
                """,
                (
                    "mercator_romanus",
                    "mercator_romanus@roma.local",
                    "Mercator Romanus",
                    pw_hash,
                    salt_hex,
                    default_settings_json,
                    now,
                ),
            )
            user_id = cur.lastrowid
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return _format_user_dict(row), None
    except Exception as exc:
        return None, f"Failed to initialize local sandbox user ({type(exc).__name__})."
    finally:
        conn.close()


def authenticate_or_create_google_user(
    email: str,
    display_name: str,
    google_sub: str,
    preferred_color: str = "Z1",
    verified_token: bool = False,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    email_clean = email.strip().lower() if isinstance(email, str) else ""
    email_err = validate_email(email_clean)
    if email_err:
        return None, email_err

    sub_clean = google_sub.strip() if isinstance(google_sub, str) and google_sub.strip() else f"google:{email_clean}"
    display_clean = (display_name or "").strip()
    if not display_clean:
        display_clean = email_clean.split("@")[0].replace(".", " ").title()
    display_clean = display_clean[:40]

    conn = get_connection()
    try:
        with conn:
            row = conn.execute(
                "SELECT * FROM users WHERE google_sub = ? OR email = ?",
                (sub_clean, email_clean),
            ).fetchone()
            if row:
                if row["auth_provider"] == "local" and not row["google_sub"] and not verified_token:
                    return (
                        None,
                        "That email belongs to a password-protected Collegium account. Please sign in with your password.",
                    )
                # Link google_sub if not yet linked
                if not row["google_sub"]:
                    conn.execute(
                        "UPDATE users SET google_sub = ?, auth_provider = 'google' WHERE id = ?",
                        (sub_clean, row["id"]),
                    )
                    row = conn.execute("SELECT * FROM users WHERE id = ?", (row["id"],)).fetchone()
                return _format_user_dict(row), None

            # Create new account tied to this Google email; prompt once for permanent @username
            candidate = f"pending_{secrets.token_hex(4)}"
            while conn.execute("SELECT id FROM users WHERE username = ?", (candidate,)).fetchone():
                candidate = f"pending_{secrets.token_hex(4)}"

            clean_color = normalize_cart_color(preferred_color, "Z3")
            salt_hex = secrets.token_hex(16)
            random_pw_hash = _hash_password(secrets.token_urlsafe(32), salt_hex)
            now = int(time.time())
            default_settings_json = json.dumps(DEFAULT_USER_SETTINGS)

            cur = conn.execute(
                """
                INSERT INTO users (
                    username, email, google_sub, auth_provider, display_name,
                    password_hash, password_salt, preferred_color, settings_json,
                    needs_username_setup, created_at
                )
                VALUES (?, ?, ?, 'google', ?, ?, ?, ?, ?, 1, ?)
                """,
                (candidate, email_clean, sub_clean, display_clean, random_pw_hash, salt_hex, clean_color, default_settings_json, now),
            )
            user_id = cur.lastrowid
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return _format_user_dict(row), None
    finally:
        conn.close()


def set_permanent_username(
    user_id: int,
    username: str,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    clean_uname, u_err = validate_permanent_username(username)
    if u_err:
        return None, u_err

    conn = get_connection()
    try:
        with conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not row:
                return None, "Account not found."
            keys = row.keys()
            needs_setup = (
                bool(row["needs_username_setup"])
                if "needs_username_setup" in keys and row["needs_username_setup"] is not None
                else False
            )
            if not needs_setup:
                return None, "Your Collegium username is permanent and has already been set."

            conflict = conn.execute(
                "SELECT id FROM users WHERE LOWER(username) = ? AND id != ?",
                (clean_uname, user_id),
            ).fetchone()
            if conflict:
                return None, "That username is already registered. Please choose another."

            is_admin_val = 1 if (bool(row["is_admin"]) or clean_uname in _admin_usernames()) else 0
            old_disp = str(row["display_name"] or "").strip()
            new_disp = clean_uname if (not old_disp or old_disp.lower().startswith("pending_")) else old_disp

            conn.execute(
                """
                UPDATE users
                SET username = ?, display_name = ?, needs_username_setup = 0, is_admin = ?
                WHERE id = ?
                """,
                (clean_uname, new_disp, is_admin_val, user_id),
            )
            updated_row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return _format_user_dict(updated_row), None
    except sqlite3.IntegrityError:
        return None, "That username is already registered. Please choose another."
    finally:
        conn.close()


def update_user_color(user_id: int, preferred_color: str) -> str:
    clean_color = normalize_cart_color(preferred_color, "Z1")
    conn = get_connection()
    try:
        with conn:
            conn.execute("UPDATE users SET preferred_color = ? WHERE id = ?", (clean_color, user_id))
        return clean_color
    finally:
        conn.close()


def update_user_profile(
    user_id: int,
    display_name: Optional[str] = None,
    email: Optional[str] = None,
    preferred_color: Optional[str] = None,
    current_password: Optional[str] = None,
    new_password: Optional[str] = None,
    settings: Optional[Dict[str, Any]] = None,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    conn = get_connection()
    try:
        with conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not row:
                return None, "Account not found."

            new_display = row["display_name"]
            if display_name is not None:
                clean_disp = display_name.strip()
                if not clean_disp or len(clean_disp) > 40:
                    return None, "Display name must be between 1 and 40 characters."
                new_display = clean_disp

            new_email = row["email"] or f"{row['username']}@roma.local"
            if email is not None:
                clean_email = email.strip().lower()
                email_err = validate_email(clean_email)
                if email_err:
                    return None, email_err
                conflict = conn.execute(
                    "SELECT id FROM users WHERE email = ? AND id != ?",
                    (clean_email, user_id),
                ).fetchone()
                if conflict:
                    return None, "That email address is already tied to another account."
                new_email = clean_email

            new_color = normalize_cart_color(preferred_color, row["preferred_color"]) if preferred_color else row["preferred_color"]

            current_settings = _parse_user_settings(row["settings_json"])
            if isinstance(settings, dict):
                if "defaultBoardView" in settings and settings["defaultBoardView"] in (
                    "auto",
                    "both",
                    "split",
                    "rome",
                    "market",
                    "dynamic",
                    "original",
                    "minimal",
                ):
                    bv = settings["defaultBoardView"]
                    current_settings["defaultBoardView"] = "both" if bv == "split" else bv
                if "autoPromptCargoLoad" in settings:
                    current_settings["autoPromptCargoLoad"] = bool(settings["autoPromptCargoLoad"])
                if "animateDice" in settings:
                    current_settings["animateDice"] = bool(settings["animateDice"])
                if "paceBotTurns" in settings:
                    current_settings["paceBotTurns"] = bool(settings["paceBotTurns"])
                if "soundEffects" in settings:
                    current_settings["soundEffects"] = bool(settings["soundEffects"])
                if "confirmEndTurn" in settings:
                    current_settings["confirmEndTurn"] = bool(settings["confirmEndTurn"])
                if "allowUndoByDefault" in settings:
                    current_settings["allowUndoByDefault"] = bool(settings["allowUndoByDefault"])
                if "skipMissionCompletionPopups" in settings:
                    current_settings["skipMissionCompletionPopups"] = bool(settings["skipMissionCompletionPopups"])
                if "hotkeys" in settings and isinstance(settings["hotkeys"], dict):
                    current_settings["hotkeys"] = sanitize_hotkeys_dict(settings["hotkeys"])

            pw_hash = row["password_hash"]
            pw_salt = row["password_salt"]
            if new_password:
                if row["auth_provider"] == "local":
                    if not current_password:
                        return None, "Please enter your current password to set a new password."
                    actual_hash = _hash_password(current_password, row["password_salt"])
                    if not hmac.compare_digest(row["password_hash"], actual_hash):
                        return None, "Current password is incorrect."
                pw_err = validate_password_strength(new_password)
                if pw_err:
                    return None, pw_err
                pw_salt = secrets.token_hex(16)
                pw_hash = _hash_password(new_password, pw_salt)

            conn.execute(
                """
                UPDATE users
                SET display_name = ?, email = ?, preferred_color = ?,
                    password_hash = ?, password_salt = ?, settings_json = ?
                WHERE id = ?
                """,
                (
                    new_display,
                    new_email,
                    new_color,
                    pw_hash,
                    pw_salt,
                    json.dumps(current_settings),
                    user_id,
                ),
            )

            # Update user's display name in lobby/active game seats
            conn.execute(
                "UPDATE game_players SET player_name = ? WHERE user_id = ?",
                (new_display, user_id),
            )

            updated_row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return _format_user_dict(updated_row), None
    finally:
        conn.close()


def get_users_allow_undo_map(user_ids: List[int]) -> Dict[int, bool]:
    clean_ids = [int(uid) for uid in user_ids if uid is not None]
    if not clean_ids:
        return {}
    placeholders = ",".join("?" for _ in clean_ids)
    conn = get_connection()
    try:
        rows = conn.execute(
            f"SELECT id, settings_json FROM users WHERE id IN ({placeholders})",
            tuple(clean_ids),
        ).fetchall()
        out: Dict[int, bool] = {}
        for r in rows:
            parsed = _parse_user_settings(r["settings_json"])
            out[int(r["id"])] = bool(parsed.get("allowUndoByDefault", False))
        return out
    finally:
        conn.close()


def authenticate_user(username: str, password: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    if not isinstance(username, str) or not isinstance(password, str):
        return None, "Invalid credentials."
    ident_clean = username.strip().lower()
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM users WHERE username = ? OR email = ?",
            (ident_clean, ident_clean),
        ).fetchone()
        if not row:
            # Constant-time dummy work to mitigate user enumeration timing
            _hash_password(password, "00" * 16)
            return None, "Invalid username/email or password."
        expected_hash = row["password_hash"]
        actual_hash = _hash_password(password, row["password_salt"])
        if not hmac.compare_digest(expected_hash, actual_hash):
            return None, "Invalid username/email or password."
        return _format_user_dict(row), None
    finally:
        conn.close()


def create_session(user_id: int) -> Tuple[str, str]:
    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_session_token(raw_token)
    csrf_token = secrets.token_hex(24)
    now = int(time.time())
    expires_at = now + SESSION_TTL_SECONDS

    conn = get_connection()
    try:
        with conn:
            conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
            conn.execute(
                """
                INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (token_hash, user_id, csrf_token, now, expires_at),
            )
    finally:
        conn.close()
    return raw_token, csrf_token


def get_session_user(raw_token: str) -> Optional[Dict[str, Any]]:
    if not raw_token:
        return None
    token_hash = _hash_session_token(raw_token)
    now = int(time.time())
    conn = get_connection()
    try:
        row = conn.execute(
            """
            SELECT s.csrf_token, s.expires_at,
                   u.*
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ?
            """,
            (token_hash,),
        ).fetchone()
        if not row:
            return None
        if row["expires_at"] < now:
            with conn:
                conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
            return None
        return _format_user_dict(row, csrf_token=row["csrf_token"])
    finally:
        conn.close()


def invalidate_user_sessions(user_id: int) -> None:
    """Invalidate all active sessions for the user on logout or account deactivation."""
    conn = get_connection()
    try:
        with conn:
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    finally:
        conn.close()


def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (int(user_id),)).fetchone()
        if not row:
            return None
        return _format_user_dict(row)
    finally:
        conn.close()


def get_leaderboard() -> List[Dict[str, Any]]:
    """Return top merchants ranked strictly across multiplayer games (>= 2 human players)."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            WITH mp_games AS (
                SELECT game_id
                FROM completed_game_players
                GROUP BY game_id
                HAVING SUM(CASE WHEN is_bot = 0 THEN 1 ELSE 0 END) >= 2
            ),
            mp_stats AS (
                SELECT
                    cgp.user_id,
                    COUNT(*) AS games_played,
                    SUM(CASE WHEN cgp.won = 1 THEN 1 ELSE 0 END) AS games_won,
                    MAX(cgp.final_wealth) AS best_wealth
                FROM completed_game_players cgp
                JOIN mp_games mg ON mg.game_id = cgp.game_id
                WHERE cgp.user_id IS NOT NULL AND cgp.is_bot = 0
                GROUP BY cgp.user_id
            )
            SELECT
                u.id,
                u.display_name,
                u.preferred_color,
                ms.games_played,
                ms.games_won,
                ms.best_wealth
            FROM users u
            JOIN mp_stats ms ON ms.user_id = u.id
            ORDER BY ms.games_won DESC, ms.best_wealth DESC, ms.games_played DESC, u.id ASC
            LIMIT 20
            """
        ).fetchall()
        return [
            {
                "userId": r["id"],
                "displayName": r["display_name"],
                "preferredColor": r["preferred_color"],
                "gamesPlayed": int(r["games_played"] or 0),
                "gamesWon": int(r["games_won"] or 0),
                "bestWealth": int(r["best_wealth"] or 0),
            }
            for r in rows
        ]
    finally:
        conn.close()


def get_user_completed_games(user_id: int) -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        uid = int(user_id)
        cg_rows = conn.execute(
            """
            SELECT cg.*
            FROM completed_games cg
            WHERE EXISTS (
                SELECT 1
                FROM completed_game_players ucp
                WHERE ucp.game_id = cg.game_id
                  AND ucp.user_id = ?
            )
            ORDER BY cg.completed_at DESC, cg.game_id DESC
            """,
            (uid,),
        ).fetchall()

        results: List[Dict[str, Any]] = []
        for cg in cg_rows:
            gid = cg["game_id"]
            p_rows = conn.execute(
                """
                SELECT *
                FROM completed_game_players
                WHERE game_id = ?
                ORDER BY rank ASC, seat_index ASC
                """,
                (gid,),
            ).fetchall()
            board_row = conn.execute("SELECT 1 FROM games WHERE id = ?", (gid,)).fetchone()
            standings = None
            if cg["standings_json"]:
                try:
                    parsed = json.loads(cg["standings_json"])
                    if isinstance(parsed, list):
                        standings = parsed
                except Exception:
                    standings = None
            user_won = any(r["user_id"] == uid and int(r["won"] or 0) == 1 for r in p_rows)
            user_rank = next((int(r["rank"]) for r in p_rows if r["user_id"] == uid), None)
            user_score = next((int(r["final_wealth"]) for r in p_rows if r["user_id"] == uid), None)
            results.append({
                "gameId": gid,
                "gameName": cg["game_name"],
                "winnerName": cg["winner_name"],
                "season": cg["season"],
                "completedAt": int(cg["completed_at"] or 0),
                "userWon": user_won,
                "userRank": user_rank,
                "userFinalScore": user_score,
                "canReopenBoard": bool(board_row),
                "standings": standings,
                "players": [
                    {
                        "seatIndex": int(r["seat_index"]),
                        "userId": r["user_id"],
                        "isBot": bool(r["is_bot"]),
                        "botDifficulty": (
                            normalize_bot_difficulty(r["bot_difficulty"], "ionic")
                            if "bot_difficulty" in r.keys() and r["is_bot"]
                            else ("ionic" if r["is_bot"] else None)
                        ),
                        "name": r["player_name"],
                        "color": r["player_color"],
                        "finalScore": int(r["final_wealth"] or 0),
                        "rank": int(r["rank"] or 1),
                        "won": bool(r["won"]),
                    }
                    for r in p_rows
                ],
            })
        return results
    finally:
        conn.close()


def resolve_users_by_usernames(
    usernames: List[str],
    exclude_user_id: Optional[Any] = None,
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """
    Look up registered accounts by username (case-insensitive).
    Returns server-only dicts (including email for invite dispatch); never expose raw emails to clients.
    """
    clean_list = [u.lstrip("@").strip().lower() for u in usernames if u and u.strip()]
    if not clean_list:
        return [], None
    placeholders = ",".join("?" for _ in clean_list)
    conn = get_connection()
    try:
        rows = conn.execute(
            f"SELECT id, username, display_name, email FROM users WHERE COALESCE(needs_username_setup, 0) = 0 AND LOWER(username) IN ({placeholders})",
            tuple(clean_list),
        ).fetchall()
        by_uname = {str(r["username"]).lower(): r for r in rows}
        missing = [u for u in clean_list if u not in by_uname]
        if missing:
            formatted_missing = ", ".join(f"@{m}" for m in missing)
            return [], f"Unknown username(s): {formatted_missing}. Invited players must have a registered account."

        resolved: List[Dict[str, Any]] = []
        seen_ids = set()
        for u in clean_list:
            r = by_uname[u]
            if exclude_user_id is not None and r["id"] == exclude_user_id:
                continue
            if r["id"] not in seen_ids:
                seen_ids.add(r["id"])
                resolved.append(
                    {
                        "id": r["id"],
                        "username": r["username"],
                        "displayName": r["display_name"],
                        "email": r["email"] or "",
                    }
                )
        return resolved, None
    finally:
        conn.close()


def create_game_lobby(
    host_user: Dict[str, Any],
    name: str,
    max_players: int,
    initial_bots: List[Dict[str, Any]],
    invite_mode: str = "open",
    invited_users: Optional[List[Dict[str, Any]]] = None,
    speed_mode: str = "normal",
    turn_time_limit_minutes: Optional[int] = None,
) -> Dict[str, Any]:
    game_id = secrets.token_hex(6)
    now = int(time.time())
    clean_name = (name.strip() or f"{host_user['displayName']}'s Convivium")[:60]
    max_p = max(2, min(6, int(max_players)))
    clean_mode = "invite_only" if str(invite_mode).strip().lower() == "invite_only" else "open"
    clean_speed = normalize_speed_mode(speed_mode)
    clean_limit = normalize_turn_time_limit_minutes(turn_time_limit_minutes, clean_speed)
    invites_list = list(invited_users or [])

    seats = [
        {
            "seatIndex": 0,
            "userId": host_user["id"],
            "isBot": False,
            "botStrategy": None,
            "botDifficulty": None,
            "name": host_user["displayName"],
            "color": normalize_cart_color(host_user.get("preferredColor"), "Z1"),
        }
    ]
    used_colors = {seats[0]["color"]}
    all_colors = ALL_CART_COLORS

    for b in initial_bots:
        if len(seats) >= max_p:
            break
        b_color = normalize_cart_color(b.get("color"), "") if b.get("color") else None
        if not b_color or b_color in used_colors:
            b_color = next((c for c in all_colors if c not in used_colors), "Z3")
        used_colors.add(b_color)
        b_diff = normalize_bot_difficulty(b.get("difficulty") or b.get("botDifficulty"), "ionic")
        seats.append({
            "seatIndex": len(seats),
            "userId": None,
            "isBot": True,
            "botStrategy": b.get("strategy", "balanced"),
            "botDifficulty": b_diff,
            "name": b.get("name", f"Bot #{len(seats)}"),
            "color": b_color,
        })

    conn = get_connection()
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO games (
                    id, name, host_user_id, status, invite_mode, speed_mode, turn_time_limit_minutes,
                    max_players, season, phase, turn, state_json, created_at, updated_at
                )
                VALUES (?, ?, ?, 'lobby', ?, ?, ?, ?, 'Spring', 'lobby', 1, '{}', ?, ?)
                """,
                (game_id, clean_name, host_user["id"], clean_mode, clean_speed, clean_limit, max_p, now, now),
            )
            for s in seats:
                conn.execute(
                    """
                    INSERT INTO game_players (
                        game_id, seat_index, user_id, is_bot, bot_strategy, bot_difficulty, player_name, player_color
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        game_id,
                        s["seatIndex"],
                        s["userId"],
                        1 if s["isBot"] else 0,
                        s["botStrategy"],
                        s["botDifficulty"],
                        s["name"],
                        s["color"],
                    ),
                )
            for inv in invites_list:
                if inv.get("id") is not None and inv["id"] != host_user["id"]:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO game_invites (game_id, user_id, username, display_name, invited_at)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            game_id,
                            inv["id"],
                            str(inv["username"]).lower(),
                            str(inv.get("displayName") or inv["username"]),
                            now,
                        ),
                    )
    finally:
        conn.close()
    return get_game_summary(game_id, viewer_user=host_user) or {}


def get_game_summary(game_id: str, viewer_user: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM games WHERE id = ?", (game_id,)).fetchone()
        if not row:
            return None
        p_rows = conn.execute(
            "SELECT * FROM game_players WHERE game_id = ? ORDER BY seat_index ASC",
            (game_id,),
        ).fetchall()
        inv_rows = conn.execute(
            "SELECT user_id, username, display_name, invited_at FROM game_invites WHERE game_id = ? ORDER BY invited_at ASC, username ASC",
            (game_id,),
        ).fetchall()
        seats = [
            {
                "seatIndex": r["seat_index"],
                "userId": r["user_id"],
                "isBot": bool(r["is_bot"]),
                "botStrategy": r["bot_strategy"],
                "botDifficulty": (
                    normalize_bot_difficulty(r["bot_difficulty"], "ionic")
                    if "bot_difficulty" in r.keys() and r["is_bot"]
                    else ("ionic" if r["is_bot"] else None)
                ),
                "name": r["player_name"],
                "color": normalize_cart_color(r["player_color"], "Z1"),
                "finalWealth": r["final_wealth"],
            }
            for r in p_rows
        ]
        row_keys = row.keys()
        invite_mode = row["invite_mode"] if "invite_mode" in row_keys and row["invite_mode"] else "open"
        speed_mode = normalize_speed_mode(row["speed_mode"] if "speed_mode" in row_keys else "normal")
        turn_limit_min = (
            normalize_turn_time_limit_minutes(row["turn_time_limit_minutes"], "fast")
            if "turn_time_limit_minutes" in row_keys and speed_mode == "fast"
            else None
        )
        next_timeout_at = (
            int(row["next_timeout_at"])
            if "next_timeout_at" in row_keys and row["next_timeout_at"] is not None
            else None
        )
        seated_uids = {s["userId"] for s in seats if s["userId"] is not None}
        invited_uids = {r["user_id"] for r in inv_rows}
        invited_unames = {str(r["username"]).lower() for r in inv_rows}

        if viewer_user is not None:
            v_uid = viewer_user.get("id")
            v_uname = str(viewer_user.get("username") or "").lower()
            is_host = v_uid == row["host_user_id"]
            is_admin = bool(viewer_user.get("isAdmin"))
            is_seated = v_uid in seated_uids
            is_invited = is_host or (v_uid in invited_uids) or (bool(v_uname) and v_uname in invited_unames)
            can_see_invites = is_host or is_admin or is_seated or is_invited
            can_join = (
                row["status"] == "lobby"
                and not is_seated
                and len(seats) < row["max_players"]
                and (invite_mode == "open" or is_invited)
            )
        else:
            is_invited = False
            can_see_invites = True
            can_join = False

        invites = (
            [
                {
                    "userId": r["user_id"],
                    "username": r["username"],
                    "displayName": r["display_name"],
                    "seated": r["user_id"] in seated_uids,
                }
                for r in inv_rows
            ]
            if can_see_invites
            else []
        )

        return {
            "id": row["id"],
            "name": row["name"],
            "hostUserId": row["host_user_id"],
            "status": row["status"],
            "inviteMode": invite_mode,
            "speedMode": speed_mode,
            "turnTimeLimitMinutes": turn_limit_min,
            "nextTimeoutAt": next_timeout_at,
            "invites": invites,
            "invitedCount": len(inv_rows),
            "viewerIsInvited": is_invited,
            "canViewerJoin": can_join,
            "maxPlayers": row["max_players"],
            "season": row["season"],
            "phase": row["phase"],
            "turn": row["turn"],
            "winnerName": row["winner_name"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "seats": seats,
        }
    finally:
        conn.close()


def get_game_full(
    game_id: str,
    viewer_user: Optional[Dict[str, Any]] = None,
) -> Optional[Tuple[Dict[str, Any], Dict[str, Any]]]:
    summary = get_game_summary(game_id, viewer_user=viewer_user)
    if not summary:
        return None
    conn = get_connection()
    try:
        row = conn.execute("SELECT state_json FROM games WHERE id = ?", (game_id,)).fetchone()
        if not row:
            return None
        state = json.loads(row["state_json"]) if row["state_json"] else {}
        return summary, state
    finally:
        conn.close()


def list_games(limit: int = 30, viewer_user: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id FROM games ORDER BY updated_at DESC LIMIT ?",
            (int(limit),),
        ).fetchall()
        out = []
        for r in rows:
            s = get_game_summary(r["id"], viewer_user=viewer_user)
            if s:
                out.append(s)
        return out
    finally:
        conn.close()


def join_game_lobby(game_id: str, user: Dict[str, Any], preferred_color: Optional[str] = None) -> Tuple[bool, str]:
    now = int(time.time())
    conn = get_connection()
    try:
        with conn:
            g_row = conn.execute("SELECT * FROM games WHERE id = ?", (game_id,)).fetchone()
            if not g_row:
                return False, "Game not found."
            if g_row["status"] != "lobby":
                return False, "This game has already started; other players can no longer join."
            p_rows = conn.execute(
                "SELECT * FROM game_players WHERE game_id = ? ORDER BY seat_index ASC",
                (game_id,),
            ).fetchall()
            if any(r["user_id"] == user["id"] for r in p_rows):
                return True, "Already seated in this lobby."
            if len(p_rows) >= g_row["max_players"]:
                return False, "Lobby is full."

            g_keys = g_row.keys()
            invite_mode = g_row["invite_mode"] if "invite_mode" in g_keys and g_row["invite_mode"] else "open"
            if invite_mode == "invite_only" and user["id"] != g_row["host_user_id"]:
                uname_lower = str(user.get("username") or "").lower()
                inv_match = conn.execute(
                    "SELECT 1 FROM game_invites WHERE game_id = ? AND (user_id = ? OR LOWER(username) = ?)",
                    (game_id, user["id"], uname_lower),
                ).fetchone()
                if not inv_match:
                    return False, "This game is Invite-Only. Only invited players may claim an empty seat."

            used_colors = {normalize_cart_color(r["player_color"], "Z1") for r in p_rows}
            all_colors = ALL_CART_COLORS
            chosen_color = normalize_cart_color(preferred_color or user.get("preferredColor"), "Z1")
            if chosen_color in used_colors:
                chosen_color = next((c for c in all_colors if c not in used_colors), "Z1")

            conn.execute(
                """
                INSERT INTO game_players (game_id, seat_index, user_id, is_bot, bot_strategy, player_name, player_color)
                VALUES (?, ?, ?, 0, NULL, ?, ?)
                """,
                (game_id, len(p_rows), user["id"], user["displayName"], chosen_color),
            )
            conn.execute("UPDATE games SET updated_at = ? WHERE id = ?", (now, game_id))
        return True, "Joined lobby."
    finally:
        conn.close()


def invite_players_to_lobby(
    game_id: str,
    actor_user: Dict[str, Any],
    invited_users: List[Dict[str, Any]],
) -> Tuple[bool, str, List[Dict[str, Any]]]:
    now = int(time.time())
    conn = get_connection()
    newly_invited: List[Dict[str, Any]] = []
    try:
        with conn:
            g_row = conn.execute("SELECT * FROM games WHERE id = ?", (game_id,)).fetchone()
            if not g_row:
                return False, "Game not found.", []
            if g_row["status"] != "lobby":
                return False, "Cannot invite players after the game has started.", []
            if g_row["host_user_id"] != actor_user["id"] and not actor_user.get("isAdmin"):
                return False, "Only the lobby host can invite players.", []

            existing_ids = {
                r["user_id"]
                for r in conn.execute("SELECT user_id FROM game_invites WHERE game_id = ?", (game_id,)).fetchall()
            }
            seated_ids = {
                r["user_id"]
                for r in conn.execute("SELECT user_id FROM game_players WHERE game_id = ? AND user_id IS NOT NULL", (game_id,)).fetchall()
            }
            for inv in invited_users:
                uid = inv.get("id")
                if uid is None or uid == g_row["host_user_id"] or uid in seated_ids:
                    continue
                if uid not in existing_ids:
                    conn.execute(
                        """
                        INSERT INTO game_invites (game_id, user_id, username, display_name, invited_at)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            game_id,
                            uid,
                            str(inv["username"]).lower(),
                            str(inv.get("displayName") or inv["username"]),
                            now,
                        ),
                    )
                    existing_ids.add(uid)
                    newly_invited.append(inv)
            if newly_invited:
                conn.execute("UPDATE games SET updated_at = ? WHERE id = ?", (now, game_id))
        if not newly_invited:
            return True, "Selected player(s) are already invited or seated in this lobby.", []
        names_fmt = ", ".join(f"@{u['username']}" for u in newly_invited)
        return True, f"Invited {names_fmt}.", newly_invited
    finally:
        conn.close()


def add_bot_to_lobby(game_id: str, user_id: int, bot_info: Dict[str, Any]) -> Tuple[bool, str]:
    summary = get_game_summary(game_id)
    if not summary:
        return False, "Game not found."
    if summary["status"] != "lobby":
        return False, "Game has already started."
    if summary["hostUserId"] != user_id:
        return False, "Only the lobby host can add or remove AI bots."
    seats = summary["seats"]
    if len(seats) >= summary["maxPlayers"]:
        return False, f"Lobby already has the maximum of {summary['maxPlayers']} seats."

    used_colors = {s["color"] for s in seats}
    all_colors = ALL_CART_COLORS
    b_color = normalize_cart_color(bot_info.get("color"), "") if bot_info.get("color") else None
    if not b_color or b_color in used_colors:
        b_color = next((c for c in all_colors if c not in used_colors), "Z3")

    used_names = {s["name"] for s in seats}
    b_name = bot_info.get("name", "Marcus Mercator")
    if b_name in used_names:
        b_name = f"{b_name} ({len(seats) + 1})"

    b_diff = normalize_bot_difficulty(bot_info.get("difficulty") or bot_info.get("botDifficulty"), "ionic")
    now = int(time.time())
    conn = get_connection()
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO game_players (
                    game_id, seat_index, user_id, is_bot, bot_strategy, bot_difficulty, player_name, player_color
                )
                VALUES (?, ?, NULL, 1, ?, ?, ?, ?)
                """,
                (game_id, len(seats), bot_info.get("strategy", "balanced"), b_diff, b_name, b_color),
            )
            conn.execute("UPDATE games SET updated_at = ? WHERE id = ?", (now, game_id))
        return True, f"Added AI bot {b_name}."
    finally:
        conn.close()


def update_lobby_bot_seat(
    game_id: str,
    user_id: int,
    seat_index: int,
    bot_info: Dict[str, Any],
) -> Tuple[bool, str]:
    summary = get_game_summary(game_id)
    if not summary:
        return False, "Game not found."
    if summary["status"] != "lobby":
        return False, "Cannot modify bot personas after game has started."
    if summary["hostUserId"] != user_id:
        return False, "Only the lobby host can configure AI bots."
    target = next((s for s in summary["seats"] if s["seatIndex"] == seat_index), None)
    if not target or not target.get("isBot"):
        return False, "Selected seat is not an AI bot."

    other_seats = [s for s in summary["seats"] if s["seatIndex"] != seat_index]
    used_names = {s["name"] for s in other_seats}
    b_name = str(bot_info.get("name") or target["name"]).strip()[:60]
    if b_name in used_names:
        b_name = f"{b_name} ({seat_index + 1})"

    used_colors = {s["color"] for s in other_seats}
    req_color = normalize_cart_color(bot_info.get("color"), "") if bot_info.get("color") else None
    if req_color and req_color not in used_colors:
        b_color = req_color
    elif target["color"] not in used_colors:
        b_color = target["color"]
    else:
        b_color = next((c for c in ALL_CART_COLORS if c not in used_colors), "Z3")

    b_strategy = str(bot_info.get("strategy") or target.get("botStrategy") or "balanced").strip().lower()
    b_diff = normalize_bot_difficulty(
        bot_info.get("difficulty") or bot_info.get("botDifficulty") or target.get("botDifficulty"),
        "ionic",
    )
    now = int(time.time())
    conn = get_connection()
    try:
        with conn:
            conn.execute(
                """
                UPDATE game_players
                SET bot_strategy = ?, bot_difficulty = ?, player_name = ?, player_color = ?
                WHERE game_id = ? AND seat_index = ? AND is_bot = 1
                """,
                (b_strategy, b_diff, b_name, b_color, game_id, seat_index),
            )
            conn.execute("UPDATE games SET updated_at = ? WHERE id = ?", (now, game_id))
        return True, f"Updated AI seat #{seat_index + 1} to {b_name}."
    finally:
        conn.close()


def remove_seat_from_lobby(game_id: str, user_id: int, seat_index: int) -> Tuple[bool, str]:
    summary = get_game_summary(game_id)
    if not summary:
        return False, "Game not found."
    if summary["status"] != "lobby":
        return False, "Cannot remove seats after game has started."
    if summary["hostUserId"] != user_id:
        return False, "Only the lobby host can remove seats."
    if not any(s["seatIndex"] == seat_index for s in summary["seats"]):
        return False, "Selected seat was not found."

    seats = [s for s in summary["seats"] if s["seatIndex"] != seat_index]
    now = int(time.time())
    conn = get_connection()
    try:
        with conn:
            conn.execute("DELETE FROM game_players WHERE game_id = ?", (game_id,))
            for idx, s in enumerate(seats):
                is_bot = bool(s.get("isBot"))
                b_diff = normalize_bot_difficulty(s.get("botDifficulty"), "ionic") if is_bot else None
                conn.execute(
                    """
                    INSERT INTO game_players (
                        game_id, seat_index, user_id, is_bot, bot_strategy, bot_difficulty, player_name, player_color
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        game_id,
                        idx,
                        s["userId"],
                        1 if is_bot else 0,
                        s.get("botStrategy"),
                        b_diff,
                        s["name"],
                        s["color"],
                    ),
                )
            conn.execute("UPDATE games SET updated_at = ? WHERE id = ?", (now, game_id))
        return True, "Seat removed."
    finally:
        conn.close()


def update_game_state_json(game_id: str, state: Dict[str, Any]) -> None:
    """Lightweight update for non-turn state updates such as chat messages."""
    now = int(time.time())
    conn = get_connection()
    try:
        with conn:
            conn.execute(
                "UPDATE games SET state_json = ?, updated_at = ? WHERE id = ?",
                (json.dumps(state), now, game_id),
            )
    finally:
        conn.close()


def list_active_fast_game_ids_due(now: Optional[int] = None) -> List[str]:
    cur_now = int(time.time()) if now is None else int(now)
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT id FROM games
            WHERE status = 'active'
              AND speed_mode = 'fast'
              AND next_timeout_at IS NOT NULL
              AND next_timeout_at <= ?
            """,
            (cur_now,),
        ).fetchall()
        return [str(r["id"]) for r in rows]
    finally:
        conn.close()


def save_game_state(game_id: str, state: Dict[str, Any], was_Already_Finished: bool = False) -> None:
    now = int(time.time())
    status = "finished" if state.get("phase") == "finished" else "active"
    winner = state.get("winner")
    conn = get_connection()
    try:
        with conn:
            g_row = conn.execute(
                "SELECT name, speed_mode, turn_time_limit_minutes FROM games WHERE id = ?",
                (game_id,),
            ).fetchone()
            g_keys = g_row.keys() if g_row else []
            game_name = str(g_row["name"]) if g_row and g_row["name"] else f"Convivium {game_id}"
            speed_mode = normalize_speed_mode(
                g_row["speed_mode"] if g_row and "speed_mode" in g_keys else state.get("speedMode", "normal")
            )
            limit_min = normalize_turn_time_limit_minutes(
                g_row["turn_time_limit_minutes"] if g_row and "turn_time_limit_minutes" in g_keys else state.get("turnTimeLimitMinutes"),
                speed_mode,
            )
            next_timeout_at = compute_next_timeout_at(state, speed_mode, limit_min, status=status)
            conn.execute(
                """
                UPDATE games
                SET status = ?, season = ?, phase = ?, turn = ?, state_json = ?, winner_name = ?, next_timeout_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    status,
                    state.get("season", "Spring"),
                    state.get("phase", "market"),
                    int(state.get("turn", 1)),
                    json.dumps(state),
                    winner,
                    next_timeout_at,
                    now,
                    game_id,
                ),
            )
            for p in state.get("players", []):
                p_idx = int(p.get("index", 0))
                p_is_bot = 1 if p.get("isBot") else 0
                p_uid = None if p_is_bot else p.get("userId")
                p_strat = str(p.get("botStrategy") or "balanced") if p_is_bot else None
                p_diff = normalize_bot_difficulty(p.get("botDifficulty"), "ionic") if p_is_bot else None
                p_name = str(p.get("name") or f"Player {p_idx + 1}")
                p_color = normalize_cart_color(p.get("color"), "Z3")
                conn.execute(
                    """
                    UPDATE game_players
                    SET user_id = ?, is_bot = ?, bot_strategy = ?, bot_difficulty = ?, player_name = ?, player_color = ?,
                        final_wealth = ?
                    WHERE game_id = ? AND seat_index = ?
                    """,
                    (
                        p_uid,
                        p_is_bot,
                        p_strat,
                        p_diff,
                        p_name,
                        p_color,
                        int(p.get("cash", 0)) if status == "finished" else None,
                        game_id,
                        p_idx,
                    ),
                )
            affected_uids = [
                int(p["userId"])
                for p in state.get("players", [])
                if not p.get("isBot") and p.get("userId") is not None
            ]
            if status == "finished":
                upserted_uids = _upsert_completed_game(
                    conn,
                    game_id=game_id,
                    game_name=game_name,
                    state=state,
                    completed_at=now,
                )
                _recompute_user_stats(conn, affected_uids + upserted_uids)
            else:
                prev_comp = conn.execute(
                    "SELECT user_id FROM completed_game_players WHERE game_id = ? AND user_id IS NOT NULL",
                    (game_id,),
                ).fetchall()
                if prev_comp or was_Already_Finished:
                    prev_uids = [int(r["user_id"]) for r in prev_comp if r["user_id"] is not None]
                    conn.execute("DELETE FROM completed_games WHERE game_id = ?", (game_id,))
                    _recompute_user_stats(conn, affected_uids + prev_uids)
    finally:
        conn.close()


def terminate_game(game_id: str, user: Dict[str, Any]) -> Tuple[bool, str]:
    summary = get_game_summary(game_id)
    if not summary:
        return False, "Game not found."
    is_host = summary.get("hostUserId") == user.get("id")
    is_admin = bool(user.get("isAdmin"))
    if not is_host and not is_admin:
        return False, "Only the player who created this game or an administrator can terminate it."

    conn = get_connection()
    try:
        with conn:
            conn.execute("DELETE FROM game_invites WHERE game_id = ?", (game_id,))
            conn.execute("DELETE FROM game_players WHERE game_id = ?", (game_id,))
            conn.execute("DELETE FROM games WHERE id = ?", (game_id,))
        return True, f"Terminated game '{summary.get('name', game_id)}'."
    finally:
        conn.close()


