# Copyright (c) 2026 Dashiell Renaud (https://dashiellrenaud.com)
# Licensed under Creative Commons Attribution-NonCommercial-NoDerivatives 4.0
# International (CC BY-NC-ND 4.0): https://creativecommons.org/licenses/by-nc-nd/4.0/
# SPDX-License-Identifier: CC-BY-NC-ND-4.0

"""
Firebase Authentication + Cloud Firestore storage backend for Night Merchant.
Activated automatically via src/storage.py when FIREBASE_PROJECT_ID is configured.
"""

import hashlib
import hmac
import json
import logging
import os
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from typing import Any, Dict, List, Optional, Tuple

import db as local_helpers

logger = logging.getLogger("nightmerchant.firebase")

SESSION_TTL_SECONDS = local_helpers.SESSION_TTL_SECONDS
ALL_CART_COLORS = local_helpers.ALL_CART_COLORS
DEFAULT_USER_SETTINGS = local_helpers.DEFAULT_USER_SETTINGS
normalize_cart_color = local_helpers.normalize_cart_color
validate_email = local_helpers.validate_email
validate_password_strength = local_helpers.validate_password_strength
mask_email = local_helpers.mask_email
parse_invited_usernames = local_helpers.parse_invited_usernames

_init_lock = threading.Lock()
_fb_initialized = False
_firestore_client = None


def _ensure_firebase():
    global _fb_initialized, _firestore_client
    if _fb_initialized and _firestore_client is not None:
        return _firestore_client
    with _init_lock:
        if _fb_initialized and _firestore_client is not None:
            return _firestore_client
        import firebase_admin
        from firebase_admin import credentials, firestore

        project_id = os.getenv("FIREBASE_PROJECT_ID", "").strip()
        sa_json = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
        options: Dict[str, Any] = {}
        if project_id:
            options["projectId"] = project_id

        if not firebase_admin._apps:
            if sa_json:
                cred_dict = json.loads(sa_json)
                cred = credentials.Certificate(cred_dict)
                firebase_admin.initialize_app(cred, options or None)
            else:
                firebase_admin.initialize_app(options=options or None)

        _firestore_client = firestore.client()
        _fb_initialized = True
        return _firestore_client


def init_db() -> None:
    _ensure_firebase()


def _admin_usernames() -> set:
    return {
        u.strip().lower()
        for u in os.environ.get("NIGHTMERCHANT_ADMINS", "").split(",")
        if u.strip()
    }


def _format_firestore_user(doc_data: Dict[str, Any], csrf_token: Optional[str] = None) -> Dict[str, Any]:
    uname = str(doc_data.get("username", ""))
    email_val = str(doc_data.get("email") or f"{uname}@roma.local")
    settings_raw = doc_data.get("settings")
    merged_settings = dict(DEFAULT_USER_SETTINGS)
    if isinstance(settings_raw, dict):
        for k in DEFAULT_USER_SETTINGS:
            if k in settings_raw:
                merged_settings[k] = settings_raw[k]
    admin_set = _admin_usernames()
    if uname.lower() == "mercator_romanus" and "mercator_romanus" not in admin_set:
        is_admin = False
    else:
        is_admin = bool(doc_data.get("isAdmin")) or (uname.lower() in admin_set)
    out: Dict[str, Any] = {
        "id": int(doc_data["id"]),
        "username": uname,
        "displayName": str(doc_data.get("displayName") or uname),
        "email": email_val,
        "maskedEmail": mask_email(email_val),
        "authProvider": str(doc_data.get("authProvider") or "firebase"),
        "preferredColor": normalize_cart_color(doc_data.get("preferredColor"), "Z1"),
        "settings": merged_settings,
        "isAdmin": is_admin,
        "gamesPlayed": int(doc_data.get("gamesPlayed") or 0),
        "gamesWon": int(doc_data.get("gamesWon") or 0),
        "bestWealth": int(doc_data.get("bestWealth") or 0),
    }
    if csrf_token is not None:
        out["csrfToken"] = csrf_token
    return out


def _derive_bearer_csrf(firebase_uid: str) -> str:
    secret = local_helpers.get_secret_key().encode("utf-8")
    return hmac.new(secret, f"fb_csrf:{firebase_uid}".encode("utf-8"), hashlib.sha256).hexdigest()[:48]


def _mint_custom_token_str(firebase_uid: str) -> Optional[str]:
    try:
        from firebase_admin import auth as fb_auth

        tok = fb_auth.create_custom_token(firebase_uid)
        return tok.decode("utf-8") if isinstance(tok, bytes) else str(tok)
    except Exception as exc:
        logger.warning("Could not mint Firebase custom token (%s).", type(exc).__name__)
        return None


def _allocate_and_store_user(
    fs,
    firebase_uid: str,
    username_clean: str,
    email_clean: str,
    display_clean: str,
    preferred_color: str,
    auth_provider: str = "firebase",
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    from google.cloud import firestore as gc_firestore

    clean_color = normalize_cart_color(preferred_color, "Z1")
    now = int(time.time())
    is_admin = username_clean in _admin_usernames()

    counter_ref = fs.collection("nm_counters").document("users")
    uname_ref = fs.collection("nm_usernames").document(username_clean)
    email_ref = fs.collection("nm_emails").document(email_clean)
    uid_map_ref = fs.collection("nm_fb_uids").document(firebase_uid)

    @gc_firestore.transactional
    def _txn_create(transaction):
        uid_snap = uid_map_ref.get(transaction=transaction)
        if uid_snap.exists:
            existing_id = int(uid_snap.to_dict()["userId"])
            existing_doc = fs.collection("nm_users").document(str(existing_id)).get(transaction=transaction)
            if existing_doc.exists:
                return existing_doc.to_dict(), None

        uname_snap = uname_ref.get(transaction=transaction)
        if uname_snap.exists:
            return None, "That username is already registered."

        email_snap = email_ref.get(transaction=transaction)
        if email_snap.exists:
            return None, "That email address is already tied to an account."

        c_snap = counter_ref.get(transaction=transaction)
        next_id = int(c_snap.to_dict().get("nextId", 1)) if c_snap.exists else 1

        user_doc = {
            "id": next_id,
            "firebaseUid": firebase_uid,
            "username": username_clean,
            "email": email_clean,
            "authProvider": auth_provider,
            "displayName": display_clean,
            "preferredColor": clean_color,
            "settings": dict(DEFAULT_USER_SETTINGS),
            "isAdmin": is_admin,
            "gamesPlayed": 0,
            "gamesWon": 0,
            "bestWealth": 0,
            "createdAt": now,
        }

        transaction.set(counter_ref, {"nextId": next_id + 1}, merge=True)
        transaction.set(uname_ref, {"userId": next_id, "firebaseUid": firebase_uid})
        transaction.set(email_ref, {"userId": next_id, "firebaseUid": firebase_uid})
        transaction.set(uid_map_ref, {"userId": next_id})
        transaction.set(fs.collection("nm_users").document(str(next_id)), user_doc)
        return user_doc, None

    user_doc, err = _txn_create(fs.transaction())
    if err or not user_doc:
        return None, err or "Account creation failed."
    return _format_firestore_user(user_doc), None


def create_user(
    username: str,
    display_name: str,
    password: str,
    preferred_color: str = "Z1",
    email: str = "",
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    from firebase_admin import auth as fb_auth

    fs = _ensure_firebase()
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

    if fs.collection("nm_usernames").document(username_clean).get().exists:
        return None, "That username is already registered."
    if fs.collection("nm_emails").document(email_clean).get().exists:
        return None, "That email address is already tied to an account."

    try:
        fb_user = fb_auth.create_user(
            email=email_clean,
            password=password,
            display_name=display_clean,
        )
    except Exception as exc:
        msg = str(exc)
        if "EMAIL_EXISTS" in msg or "already exists" in msg.lower():
            return None, "That email address is already tied to an account."
        return None, "Could not create Firebase Authentication account."

    user_dict, store_err = _allocate_and_store_user(
        fs=fs,
        firebase_uid=fb_user.uid,
        username_clean=username_clean,
        email_clean=email_clean,
        display_clean=display_clean,
        preferred_color=preferred_color,
        auth_provider="firebase",
    )
    if store_err or not user_dict:
        try:
            fb_auth.delete_user(fb_user.uid)
        except Exception:
            pass
        return None, store_err or "Registration failed."

    custom_tok = _mint_custom_token_str(fb_user.uid)
    if custom_tok:
        user_dict["_firebaseCustomToken"] = custom_tok
    return user_dict, None


def authenticate_user(username: str, password: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    if not isinstance(username, str) or not isinstance(password, str) or not password:
        return None, "Invalid credentials."
    fs = _ensure_firebase()
    ident_clean = username.strip().lower()

    user_doc: Optional[Dict[str, Any]] = None
    if "@" in ident_clean:
        em_snap = fs.collection("nm_emails").document(ident_clean).get()
        if em_snap.exists:
            uid_int = int(em_snap.to_dict()["userId"])
            u_snap = fs.collection("nm_users").document(str(uid_int)).get()
            if u_snap.exists:
                user_doc = u_snap.to_dict()
    else:
        un_snap = fs.collection("nm_usernames").document(ident_clean).get()
        if un_snap.exists:
            uid_int = int(un_snap.to_dict()["userId"])
            u_snap = fs.collection("nm_users").document(str(uid_int)).get()
            if u_snap.exists:
                user_doc = u_snap.to_dict()

    web_api_key = (
        os.getenv("FIREBASE_SERVER_API_KEY", "").strip()
        or os.getenv("FIREBASE_WEB_API_KEY", "").strip()
    )
    if not web_api_key:
        return None, "FIREBASE_WEB_API_KEY is required on the server for password verification."

    target_email = str(user_doc["email"]) if user_doc else "nonexistent_timing_guard@invalid.local"
    verify_url = (
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key="
        + urllib.parse.quote(web_api_key)
    )
    req_body = json.dumps(
        {
            "email": target_email,
            "password": password,
            "returnSecureToken": True,
        }
    ).encode("utf-8")
    public_referer = (
        os.getenv("NIGHTMERCHANT_PUBLIC_URL", "https://dashiellrenaud.com/nightmerchant/").strip()
        or "https://dashiellrenaud.com/"
    )
    req = urllib.request.Request(
        verify_url,
        data=req_body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Referer": public_referer,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=6.0) as resp:
            auth_resp = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError:
        return None, "Invalid username/email or password."
    except Exception:
        return None, "Authentication service temporarily unavailable."

    fb_uid = str(auth_resp.get("localId") or "").strip()
    if not fb_uid:
        return None, "Invalid username/email or password."

    if not user_doc:
        # User existed in Firebase Auth before Firestore profile sync; provision profile cleanly
        base_uname = "".join(c for c in ident_clean.split("@")[0] if c.isalnum() or c in "_-.")[:24]
        if len(base_uname) < 3:
            base_uname = f"merchant_{secrets.token_hex(3)}"
        cand = base_uname
        sfx = 1
        while fs.collection("nm_usernames").document(cand).get().exists:
            sfx += 1
            cand = f"{base_uname[:20]}_{sfx}"
        disp = str(auth_resp.get("displayName") or cand)[:40]
        created_u, c_err = _allocate_and_store_user(
            fs=fs,
            firebase_uid=fb_uid,
            username_clean=cand,
            email_clean=ident_clean,
            display_clean=disp,
            preferred_color="Z1",
            auth_provider="firebase",
        )
        if c_err or not created_u:
            return None, "Invalid username/email or password."
        custom_tok = _mint_custom_token_str(fb_uid)
        if custom_tok:
            created_u["_firebaseCustomToken"] = custom_tok
        return created_u, None

    formatted = _format_firestore_user(user_doc)
    custom_tok = _mint_custom_token_str(fb_uid)
    if custom_tok:
        formatted["_firebaseCustomToken"] = custom_tok
    return formatted, None


def verify_and_sync_firebase_id_token(
    id_token: str,
    username: Optional[str] = None,
    display_name: Optional[str] = None,
    preferred_color: str = "Z1",
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Verify a Firebase Auth OIDC ID token and load or create the Firestore merchant profile."""
    from firebase_admin import auth as fb_auth

    if not id_token or not isinstance(id_token, str):
        return None, "Missing Firebase authentication token."
    fs = _ensure_firebase()
    try:
        decoded = fb_auth.verify_id_token(id_token, check_revoked=True)
    except Exception:
        return None, "Invalid or expired Firebase authentication token."

    fb_uid = str(decoded.get("uid") or "").strip()
    email_clean = str(decoded.get("email") or "").strip().lower()
    if not fb_uid or not email_clean:
        return None, "Firebase account must have a verified email address."

    csrf = _derive_bearer_csrf(fb_uid)

    uid_map = fs.collection("nm_fb_uids").document(fb_uid).get()
    if uid_map.exists:
        uid_int = int(uid_map.to_dict()["userId"])
        u_snap = fs.collection("nm_users").document(str(uid_int)).get()
        if u_snap.exists:
            return _format_firestore_user(u_snap.to_dict(), csrf_token=csrf), None

    em_map = fs.collection("nm_emails").document(email_clean).get()
    if em_map.exists:
        uid_int = int(em_map.to_dict()["userId"])
        u_ref = fs.collection("nm_users").document(str(uid_int))
        u_snap = u_ref.get()
        if u_snap.exists:
            u_ref.update({"firebaseUid": fb_uid})
            fs.collection("nm_fb_uids").document(fb_uid).set({"userId": uid_int})
            merged = dict(u_snap.to_dict())
            merged["firebaseUid"] = fb_uid
            return _format_firestore_user(merged, csrf_token=csrf), None

    # Provision new Firestore user profile
    sign_in_provider = str(decoded.get("firebase", {}).get("sign_in_provider", "firebase"))
    provider_label = "google" if "google" in sign_in_provider else "firebase"

    if username and username.strip():
        cand_uname = username.strip().lower()
        if len(cand_uname) < 3 or len(cand_uname) > 32 or not all(c.isalnum() or c in "_-." for c in cand_uname):
            return None, "Username must be 3–32 letters, numbers, underscores, hyphens, or periods."
        if fs.collection("nm_usernames").document(cand_uname).get().exists:
            return None, "That username is already registered."
    else:
        base_u = "".join(c for c in email_clean.split("@")[0] if c.isalnum() or c in "_-.")[:24]
        if len(base_u) < 3:
            base_u = f"merchant_{secrets.token_hex(3)}"
        cand_uname = base_u
        sfx = 1
        while fs.collection("nm_usernames").document(cand_uname).get().exists:
            sfx += 1
            cand_uname = f"{base_u[:20]}_{sfx}"

    disp = (display_name or decoded.get("name") or "").strip()
    if not disp:
        disp = email_clean.split("@")[0].replace(".", " ").title()
    disp = disp[:40]

    created_u, err = _allocate_and_store_user(
        fs=fs,
        firebase_uid=fb_uid,
        username_clean=cand_uname,
        email_clean=email_clean,
        display_clean=disp,
        preferred_color=preferred_color,
        auth_provider=provider_label,
    )
    if err or not created_u:
        return None, err or "Could not provision merchant profile."
    created_u["csrfToken"] = csrf
    return created_u, None


def authenticate_or_create_google_user(
    email: str,
    display_name: str,
    google_sub: str,
    preferred_color: str = "Z1",
    verified_token: bool = False,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    if not verified_token:
        return None, "Verified Google / Firebase token is required in production."
    fs = _ensure_firebase()
    email_clean = email.strip().lower()
    em_map = fs.collection("nm_emails").document(email_clean).get()
    if em_map.exists:
        uid_int = int(em_map.to_dict()["userId"])
        u_snap = fs.collection("nm_users").document(str(uid_int)).get()
        if u_snap.exists:
            return _format_firestore_user(u_snap.to_dict()), None

    base_u = "".join(c for c in email_clean.split("@")[0] if c.isalnum() or c in "_-.")[:24]
    if len(base_u) < 3:
        base_u = f"merchant_{secrets.token_hex(3)}"
    cand = base_u
    sfx = 1
    while fs.collection("nm_usernames").document(cand).get().exists:
        sfx += 1
        cand = f"{base_u[:20]}_{sfx}"
    fb_uid = f"google:{google_sub}"
    disp = (display_name or cand).strip()[:40]
    return _allocate_and_store_user(
        fs=fs,
        firebase_uid=fb_uid,
        username_clean=cand,
        email_clean=email_clean,
        display_clean=disp,
        preferred_color=preferred_color,
        auth_provider="google",
    )


def create_session(user_id: int) -> Tuple[str, str]:
    fs = _ensure_firebase()
    raw_token = secrets.token_urlsafe(32)
    secret = local_helpers.get_secret_key().encode("utf-8")
    token_hash = hmac.new(secret, raw_token.encode("utf-8"), hashlib.sha256).hexdigest()
    csrf_token = secrets.token_hex(24)
    now = int(time.time())
    expires_at = now + SESSION_TTL_SECONDS
    fs.collection("nm_sessions").document(token_hash).set(
        {
            "userId": int(user_id),
            "csrfToken": csrf_token,
            "createdAt": now,
            "expiresAt": expires_at,
        }
    )
    return raw_token, csrf_token


def get_session_user(raw_token: str) -> Optional[Dict[str, Any]]:
    if not raw_token:
        return None
    fs = _ensure_firebase()
    secret = local_helpers.get_secret_key().encode("utf-8")
    token_hash = hmac.new(secret, raw_token.encode("utf-8"), hashlib.sha256).hexdigest()
    s_ref = fs.collection("nm_sessions").document(token_hash)
    s_snap = s_ref.get()
    if not s_snap.exists:
        return None
    s_data = s_snap.to_dict()
    if int(s_data.get("expiresAt", 0)) < int(time.time()):
        s_ref.delete()
        return None
    u_snap = fs.collection("nm_users").document(str(s_data["userId"])).get()
    if not u_snap.exists:
        return None
    return _format_firestore_user(u_snap.to_dict(), csrf_token=str(s_data.get("csrfToken", "")))


def invalidate_user_sessions(user_id: int) -> None:
    from firebase_admin import auth as fb_auth

    fs = _ensure_firebase()
    u_snap = fs.collection("nm_users").document(str(int(user_id))).get()
    if u_snap.exists:
        fb_uid = str(u_snap.to_dict().get("firebaseUid") or "")
        if fb_uid and not fb_uid.startswith("google:"):
            try:
                fb_auth.revoke_refresh_tokens(fb_uid)
            except Exception:
                pass
    for doc in fs.collection("nm_sessions").where("userId", "==", int(user_id)).stream():
        doc.reference.delete()


def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    fs = _ensure_firebase()
    snap = fs.collection("nm_users").document(str(int(user_id))).get()
    if not snap.exists:
        return None
    return _format_firestore_user(snap.to_dict())


def update_user_profile(
    user_id: int,
    display_name: Optional[str] = None,
    email: Optional[str] = None,
    preferred_color: Optional[str] = None,
    current_password: Optional[str] = None,
    new_password: Optional[str] = None,
    settings: Optional[Dict[str, Any]] = None,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    from firebase_admin import auth as fb_auth

    fs = _ensure_firebase()
    u_ref = fs.collection("nm_users").document(str(int(user_id)))
    snap = u_ref.get()
    if not snap.exists:
        return None, "Account not found."
    data = dict(snap.to_dict())

    new_display = str(data.get("displayName") or data["username"])
    if display_name is not None:
        clean_disp = display_name.strip()
        if not clean_disp or len(clean_disp) > 40:
            return None, "Display name must be between 1 and 40 characters."
        new_display = clean_disp

    old_email = str(data.get("email") or "").lower()
    new_email = old_email
    if email is not None:
        clean_email = email.strip().lower()
        email_err = validate_email(clean_email)
        if email_err:
            return None, email_err
        if clean_email != old_email:
            em_conflict = fs.collection("nm_emails").document(clean_email).get()
            if em_conflict.exists and int(em_conflict.to_dict().get("userId", -1)) != int(user_id):
                return None, "That email address is already tied to another account."
            new_email = clean_email

    new_color = (
        normalize_cart_color(preferred_color, data.get("preferredColor", "Z1"))
        if preferred_color
        else normalize_cart_color(data.get("preferredColor"), "Z1")
    )

    curr_settings = dict(DEFAULT_USER_SETTINGS)
    if isinstance(data.get("settings"), dict):
        curr_settings.update({k: data["settings"][k] for k in DEFAULT_USER_SETTINGS if k in data["settings"]})
    if isinstance(settings, dict):
        if "defaultBoardView" in settings and settings["defaultBoardView"] in (
            "auto", "both", "split", "rome", "market", "dynamic", "original", "minimal"
        ):
            bv = settings["defaultBoardView"]
            curr_settings["defaultBoardView"] = "both" if bv == "split" else bv
        for b_key in (
            "autoPromptCargoLoad",
            "animateDice",
            "paceBotTurns",
            "soundEffects",
            "confirmEndTurn",
            "allowUndoByDefault",
            "skipMissionCompletionPopups",
        ):
            if b_key in settings:
                curr_settings[b_key] = bool(settings[b_key])

    fb_uid = str(data.get("firebaseUid") or "")
    if new_password:
        pw_err = validate_password_strength(new_password)
        if pw_err:
            return None, pw_err
        if current_password:
            _, a_err = authenticate_user(old_email, current_password)
            if a_err:
                return None, "Current password is incorrect."
        elif data.get("authProvider") != "google":
            return None, "Please enter your current password to set a new password."
        if fb_uid and not fb_uid.startswith("google:"):
            try:
                fb_auth.update_user(fb_uid, password=new_password)
            except Exception:
                return None, "Failed to update password in Firebase Authentication."

    if fb_uid and not fb_uid.startswith("google:") and (new_email != old_email or new_display != data.get("displayName")):
        try:
            fb_auth.update_user(fb_uid, email=new_email, display_name=new_display)
        except Exception:
            return None, "Could not update email or display name in Firebase Authentication."

    if new_email != old_email:
        if old_email:
            fs.collection("nm_emails").document(old_email).delete()
        fs.collection("nm_emails").document(new_email).set({"userId": int(user_id), "firebaseUid": fb_uid})

    updates = {
        "displayName": new_display,
        "email": new_email,
        "preferredColor": new_color,
        "settings": curr_settings,
    }
    u_ref.update(updates)
    data.update(updates)
    return _format_firestore_user(data), None


def get_users_allow_undo_map(user_ids: List[Any]) -> Dict[Any, bool]:
    fs = _ensure_firebase()
    out: Dict[Any, bool] = {}
    for uid in {int(u) for u in user_ids if u is not None}:
        snap = fs.collection("nm_users").document(str(uid)).get()
        if snap.exists:
            st = snap.to_dict().get("settings") or {}
            out[uid] = bool(st.get("allowUndoByDefault", False))
    return out


def resolve_users_by_usernames(
    usernames: List[str],
    exclude_user_id: Optional[Any] = None,
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    fs = _ensure_firebase()
    clean_list = [u.lstrip("@").strip().lower() for u in usernames if u and u.strip()]
    if not clean_list:
        return [], None

    missing: List[str] = []
    resolved: List[Dict[str, Any]] = []
    seen_ids = set()

    for uname in clean_list:
        un_snap = fs.collection("nm_usernames").document(uname).get()
        if not un_snap.exists:
            missing.append(uname)
            continue
        uid_int = int(un_snap.to_dict()["userId"])
        u_snap = fs.collection("nm_users").document(str(uid_int)).get()
        if not u_snap.exists:
            missing.append(uname)
            continue
        u_data = u_snap.to_dict()
        if exclude_user_id is not None and uid_int == int(exclude_user_id):
            continue
        if uid_int not in seen_ids:
            seen_ids.add(uid_int)
            resolved.append(
                {
                    "id": uid_int,
                    "username": str(u_data["username"]),
                    "displayName": str(u_data.get("displayName") or u_data["username"]),
                    "email": str(u_data.get("email") or ""),
                }
            )

    if missing:
        return [], f"Unknown username(s): {', '.join('@' + m for m in missing)}. Invited players must have a registered account."
    return resolved, None


def _build_summary_from_game_doc(
    g_data: Dict[str, Any],
    viewer_user: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    seats = [
        {
            "seatIndex": int(s["seatIndex"]),
            "userId": s.get("userId"),
            "isBot": bool(s.get("isBot")),
            "botStrategy": s.get("botStrategy"),
            "name": str(s.get("name", "")),
            "color": normalize_cart_color(s.get("color"), "Z1"),
            "finalWealth": s.get("finalWealth"),
        }
        for s in (g_data.get("seats") or [])
    ]
    raw_invites = list(g_data.get("invites") or [])
    invite_mode = str(g_data.get("inviteMode") or "open")
    seated_uids = {s["userId"] for s in seats if s.get("userId") is not None}
    invited_uids = {inv.get("userId") for inv in raw_invites if inv.get("userId") is not None}
    invited_unames = {str(inv.get("username") or "").lower() for inv in raw_invites}

    if viewer_user is not None:
        v_uid = viewer_user.get("id")
        v_uname = str(viewer_user.get("username") or "").lower()
        is_host = v_uid == g_data.get("hostUserId")
        is_admin = bool(viewer_user.get("isAdmin"))
        is_seated = v_uid in seated_uids
        is_invited = is_host or (v_uid in invited_uids) or (bool(v_uname) and v_uname in invited_unames)
        can_see_invites = is_host or is_admin or is_seated or is_invited
        can_join = (
            g_data.get("status") == "lobby"
            and not is_seated
            and len(seats) < int(g_data.get("maxPlayers", 4))
            and (invite_mode == "open" or is_invited)
        )
    else:
        is_invited = False
        can_see_invites = True
        can_join = False

    invites_out = (
        [
            {
                "userId": inv.get("userId"),
                "username": inv.get("username"),
                "displayName": inv.get("displayName"),
                "seated": inv.get("userId") in seated_uids,
            }
            for inv in raw_invites
        ]
        if can_see_invites
        else []
    )

    return {
        "id": str(g_data["id"]),
        "name": str(g_data.get("name", "")),
        "hostUserId": g_data.get("hostUserId"),
        "status": str(g_data.get("status", "lobby")),
        "inviteMode": invite_mode,
        "invites": invites_out,
        "invitedCount": len(raw_invites),
        "viewerIsInvited": is_invited,
        "canViewerJoin": can_join,
        "maxPlayers": int(g_data.get("maxPlayers", 4)),
        "season": str(g_data.get("season", "Spring")),
        "phase": str(g_data.get("phase", "lobby")),
        "turn": int(g_data.get("turn", 1)),
        "winnerName": g_data.get("winnerName"),
        "createdAt": int(g_data.get("createdAt", 0)),
        "updatedAt": int(g_data.get("updatedAt", 0)),
        "seats": seats,
    }


def create_game_lobby(
    host_user: Dict[str, Any],
    name: str,
    max_players: int,
    initial_bots: List[Dict[str, Any]],
    invite_mode: str = "open",
    invited_users: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    fs = _ensure_firebase()
    game_id = secrets.token_hex(6)
    now = int(time.time())
    clean_name = (name.strip() or f"{host_user['displayName']}'s Convivium")[:60]
    max_p = max(2, min(6, int(max_players)))
    clean_mode = "invite_only" if str(invite_mode).strip().lower() == "invite_only" else "open"

    seats = [
        {
            "seatIndex": 0,
            "userId": host_user["id"],
            "isBot": False,
            "botStrategy": None,
            "name": host_user["displayName"],
            "color": normalize_cart_color(host_user.get("preferredColor"), "Z1"),
            "finalWealth": None,
        }
    ]
    used_colors = {seats[0]["color"]}
    for b in initial_bots:
        if len(seats) >= max_p:
            break
        b_color = normalize_cart_color(b.get("color"), "") if b.get("color") else None
        if not b_color or b_color in used_colors:
            b_color = next((c for c in ALL_CART_COLORS if c not in used_colors), "Z3")
        used_colors.add(b_color)
        seats.append(
            {
                "seatIndex": len(seats),
                "userId": None,
                "isBot": True,
                "botStrategy": b.get("strategy", "balanced"),
                "name": b.get("name", f"Bot #{len(seats)}"),
                "color": b_color,
                "finalWealth": None,
            }
        )

    invites_docs = []
    seen_inv = set()
    for inv in (invited_users or []):
        uid = inv.get("id")
        if uid is not None and uid != host_user["id"] and uid not in seen_inv:
            seen_inv.add(uid)
            invites_docs.append(
                {
                    "userId": uid,
                    "username": str(inv["username"]).lower(),
                    "displayName": str(inv.get("displayName") or inv["username"]),
                    "invitedAt": now,
                }
            )

    game_doc = {
        "id": game_id,
        "name": clean_name,
        "hostUserId": host_user["id"],
        "status": "lobby",
        "inviteMode": clean_mode,
        "invites": invites_docs,
        "maxPlayers": max_p,
        "season": "Spring",
        "phase": "lobby",
        "turn": 1,
        "winnerName": None,
        "seats": seats,
        "stateJson": "{}",
        "createdAt": now,
        "updatedAt": now,
    }
    fs.collection("nm_games").document(game_id).set(game_doc)
    return _build_summary_from_game_doc(game_doc, viewer_user=host_user)


def get_game_summary(game_id: str, viewer_user: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    fs = _ensure_firebase()
    snap = fs.collection("nm_games").document(game_id).get()
    if not snap.exists:
        return None
    return _build_summary_from_game_doc(snap.to_dict(), viewer_user=viewer_user)


def _serialize_game_state_zlib(state: Dict[str, Any]) -> bytes:
    """Compress JSON game state so 3-snapshot states (~1.08 MB raw) stay ~90-125 KB in Firestore (<1 MiB limit)."""
    raw = json.dumps(state, separators=(",", ":")).encode("utf-8")
    comp = zlib.compress(raw, level=6)
    if len(comp) > 900_000 and isinstance(state.get("turnSnapshotHistory"), list) and state["turnSnapshotHistory"]:
        trimmed = dict(state)
        trimmed["turnSnapshotHistory"] = list(state["turnSnapshotHistory"][-1:])
        raw = json.dumps(trimmed, separators=(",", ":")).encode("utf-8")
        comp = zlib.compress(raw, level=6)
    return comp


def _deserialize_game_state(g_data: Dict[str, Any]) -> Dict[str, Any]:
    z_blob = g_data.get("stateZlib")
    if isinstance(z_blob, (bytes, bytearray)) and len(z_blob) > 0:
        return json.loads(zlib.decompress(bytes(z_blob)).decode("utf-8"))
    raw_json = g_data.get("stateJson")
    if isinstance(raw_json, str) and raw_json.strip():
        return json.loads(raw_json)
    return {}


def get_game_full(
    game_id: str,
    viewer_user: Optional[Dict[str, Any]] = None,
) -> Optional[Tuple[Dict[str, Any], Dict[str, Any]]]:
    fs = _ensure_firebase()
    snap = fs.collection("nm_games").document(game_id).get()
    if not snap.exists:
        return None
    g_data = snap.to_dict()
    summary = _build_summary_from_game_doc(g_data, viewer_user=viewer_user)
    state = _deserialize_game_state(g_data)
    return summary, state


def list_games(limit: int = 30, viewer_user: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    from google.cloud import firestore as gc_firestore

    fs = _ensure_firebase()
    query = fs.collection("nm_games").order_by("updatedAt", direction=gc_firestore.Query.DESCENDING).limit(int(limit))
    return [_build_summary_from_game_doc(doc.to_dict(), viewer_user=viewer_user) for doc in query.stream()]


def join_game_lobby(game_id: str, user: Dict[str, Any], preferred_color: Optional[str] = None) -> Tuple[bool, str]:
    from google.cloud import firestore as gc_firestore

    fs = _ensure_firebase()
    g_ref = fs.collection("nm_games").document(game_id)
    now = int(time.time())

    @gc_firestore.transactional
    def _txn_join(transaction):
        snap = g_ref.get(transaction=transaction)
        if not snap.exists:
            return False, "Game not found."
        g_data = snap.to_dict()
        if g_data.get("status") != "lobby":
            return False, "This game has already started; other players can no longer join."
        seats = list(g_data.get("seats") or [])
        if any(s.get("userId") == user["id"] for s in seats):
            return True, "Already seated in this lobby."
        if len(seats) >= int(g_data.get("maxPlayers", 4)):
            return False, "Lobby is full."

        invite_mode = str(g_data.get("inviteMode") or "open")
        if invite_mode == "invite_only" and user["id"] != g_data.get("hostUserId"):
            uname_lower = str(user.get("username") or "").lower()
            invites = g_data.get("invites") or []
            allowed = any(
                inv.get("userId") == user["id"] or str(inv.get("username") or "").lower() == uname_lower
                for inv in invites
            )
            if not allowed:
                return False, "This game is Invite-Only. Only invited players may claim an empty seat."

        used_colors = {normalize_cart_color(s.get("color"), "Z1") for s in seats}
        chosen_color = normalize_cart_color(preferred_color or user.get("preferredColor"), "Z1")
        if chosen_color in used_colors:
            chosen_color = next((c for c in ALL_CART_COLORS if c not in used_colors), "Z1")

        seats.append(
            {
                "seatIndex": len(seats),
                "userId": user["id"],
                "isBot": False,
                "botStrategy": None,
                "name": user["displayName"],
                "color": chosen_color,
                "finalWealth": None,
            }
        )
        transaction.update(g_ref, {"seats": seats, "updatedAt": now})
        return True, "Joined lobby."

    return _txn_join(fs.transaction())


def invite_players_to_lobby(
    game_id: str,
    actor_user: Dict[str, Any],
    invited_users: List[Dict[str, Any]],
) -> Tuple[bool, str, List[Dict[str, Any]]]:
    from google.cloud import firestore as gc_firestore

    fs = _ensure_firebase()
    g_ref = fs.collection("nm_games").document(game_id)
    now = int(time.time())

    @gc_firestore.transactional
    def _txn_invite(transaction):
        snap = g_ref.get(transaction=transaction)
        if not snap.exists:
            return False, "Game not found.", []
        g_data = snap.to_dict()
        if g_data.get("status") != "lobby":
            return False, "Cannot invite players after the game has started.", []
        if g_data.get("hostUserId") != actor_user["id"] and not actor_user.get("isAdmin"):
            return False, "Only the lobby host can invite players.", []

        invites = list(g_data.get("invites") or [])
        existing_ids = {inv.get("userId") for inv in invites}
        seated_ids = {s.get("userId") for s in (g_data.get("seats") or []) if s.get("userId") is not None}
        newly_added: List[Dict[str, Any]] = []

        for inv in invited_users:
            uid = inv.get("id")
            if uid is None or uid == g_data.get("hostUserId") or uid in seated_ids:
                continue
            if uid not in existing_ids:
                invites.append(
                    {
                        "userId": uid,
                        "username": str(inv["username"]).lower(),
                        "displayName": str(inv.get("displayName") or inv["username"]),
                        "invitedAt": now,
                    }
                )
                existing_ids.add(uid)
                newly_added.append(inv)

        if newly_added:
            transaction.update(g_ref, {"invites": invites, "updatedAt": now})
            names_fmt = ", ".join(f"@{u['username']}" for u in newly_added)
            return True, f"Invited {names_fmt}.", newly_added
        return True, "Selected player(s) are already invited or seated in this lobby.", []

    return _txn_invite(fs.transaction())


def add_bot_to_lobby(game_id: str, user_id: int, bot_info: Dict[str, Any]) -> Tuple[bool, str]:
    fs = _ensure_firebase()
    g_ref = fs.collection("nm_games").document(game_id)
    snap = g_ref.get()
    if not snap.exists:
        return False, "Game not found."
    g_data = snap.to_dict()
    if g_data.get("status") != "lobby":
        return False, "Game has already started."
    if g_data.get("hostUserId") != user_id:
        return False, "Only the lobby host can add or remove AI bots."
    seats = list(g_data.get("seats") or [])
    max_p = int(g_data.get("maxPlayers", 4))
    if len(seats) >= max_p:
        return False, f"Lobby already has the maximum of {max_p} seats."

    used_colors = {s["color"] for s in seats}
    b_color = normalize_cart_color(bot_info.get("color"), "") if bot_info.get("color") else None
    if not b_color or b_color in used_colors:
        b_color = next((c for c in ALL_CART_COLORS if c not in used_colors), "Z3")

    used_names = {s["name"] for s in seats}
    b_name = bot_info.get("name", "Marcus Mercator")
    if b_name in used_names:
        b_name = f"{b_name} ({len(seats) + 1})"

    seats.append(
        {
            "seatIndex": len(seats),
            "userId": None,
            "isBot": True,
            "botStrategy": bot_info.get("strategy", "balanced"),
            "name": b_name,
            "color": b_color,
            "finalWealth": None,
        }
    )
    g_ref.update({"seats": seats, "updatedAt": int(time.time())})
    return True, f"Added AI bot {b_name}."


def update_lobby_bot_seat(
    game_id: str,
    user_id: int,
    seat_index: int,
    bot_info: Dict[str, Any],
) -> Tuple[bool, str]:
    fs = _ensure_firebase()
    g_ref = fs.collection("nm_games").document(game_id)
    snap = g_ref.get()
    if not snap.exists:
        return False, "Game not found."
    g_data = snap.to_dict()
    if g_data.get("status") != "lobby":
        return False, "Cannot modify bot personas after game has started."
    if g_data.get("hostUserId") != user_id:
        return False, "Only the lobby host can configure AI bots."
    seats = list(g_data.get("seats") or [])
    target = next((s for s in seats if int(s["seatIndex"]) == seat_index), None)
    if not target or not target.get("isBot"):
        return False, "Selected seat is not an AI bot."

    other_seats = [s for s in seats if int(s["seatIndex"]) != seat_index]
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

    target["botStrategy"] = str(bot_info.get("strategy") or target.get("botStrategy") or "balanced").strip().lower()
    target["name"] = b_name
    target["color"] = b_color
    g_ref.update({"seats": seats, "updatedAt": int(time.time())})
    return True, f"Updated AI seat #{seat_index + 1} to {b_name}."


def remove_seat_from_lobby(game_id: str, user_id: int, seat_index: int) -> Tuple[bool, str]:
    fs = _ensure_firebase()
    g_ref = fs.collection("nm_games").document(game_id)
    snap = g_ref.get()
    if not snap.exists:
        return False, "Game not found."
    g_data = snap.to_dict()
    if g_data.get("status") != "lobby":
        return False, "Cannot remove seats after game has started."
    if g_data.get("hostUserId") != user_id:
        return False, "Only the lobby host can remove seats."
    if seat_index <= 0:
        return False, "Cannot remove the host seat."

    seats = [s for s in (g_data.get("seats") or []) if int(s["seatIndex"]) != seat_index]
    for idx, s in enumerate(seats):
        s["seatIndex"] = idx
    g_ref.update({"seats": seats, "updatedAt": int(time.time())})
    return True, "Seat removed."


def _recompute_firestore_user_stats(fs, user_ids: List[int]) -> None:
    for uid in sorted({int(u) for u in user_ids if u is not None}):
        docs = list(fs.collection("nm_completed_games").where("participantUserIds", "array_contains", uid).stream())
        played = len(docs)
        won = 0
        best_wealth = 0
        for d in docs:
            cd = d.to_dict()
            for p in (cd.get("players") or []):
                if p.get("userId") == uid:
                    if p.get("won"):
                        won += 1
                    best_wealth = max(best_wealth, int(p.get("finalScore") or 0))
        u_ref = fs.collection("nm_users").document(str(uid))
        if u_ref.get().exists:
            u_ref.update({"gamesPlayed": played, "gamesWon": won, "bestWealth": best_wealth})


def save_game_state(game_id: str, state: Dict[str, Any], was_Already_Finished: bool = False) -> None:
    fs = _ensure_firebase()
    now = int(time.time())
    status = "finished" if state.get("phase") == "finished" else "active"
    winner = state.get("winner")
    g_ref = fs.collection("nm_games").document(game_id)
    snap = g_ref.get()
    if not snap.exists:
        return
    g_data = snap.to_dict()
    seats = list(g_data.get("seats") or [])
    players = list(state.get("players") or [])

    if status == "finished":
        cash_by_idx = {int(p["index"]): int(p.get("cash", 0)) for p in players if "index" in p}
        for s in seats:
            if int(s["seatIndex"]) in cash_by_idx:
                s["finalWealth"] = cash_by_idx[int(s["seatIndex"])]
    else:
        for s in seats:
            s["finalWealth"] = None

    g_ref.update(
        {
            "status": status,
            "season": state.get("season", "Spring"),
            "phase": state.get("phase", "market"),
            "turn": int(state.get("turn", 1)),
            "stateZlib": _serialize_game_state_zlib(state),
            "stateJson": "",
            "winnerName": winner,
            "seats": seats,
            "updatedAt": now,
        }
    )

    affected_uids = [int(p["userId"]) for p in players if p.get("userId") is not None]
    cg_ref = fs.collection("nm_completed_games").document(game_id)

    if status == "finished":
        standings = state.get("finalStandings")
        rank_by_idx: Dict[int, int] = {}
        won_by_idx: Dict[int, bool] = {}
        if isinstance(standings, list):
            for s_item in standings:
                if isinstance(s_item, dict) and "playerIndex" in s_item:
                    idx_i = int(s_item["playerIndex"])
                    rank_by_idx[idx_i] = int(s_item.get("rank", 1))
                    won_by_idx[idx_i] = bool(s_item.get("won", False))

        comp_players = []
        human_cnt = 0
        for i, p in enumerate(players):
            s_idx = int(p.get("index", i))
            is_b = bool(p.get("isBot"))
            if not is_b:
                human_cnt += 1
            comp_players.append(
                {
                    "seatIndex": s_idx,
                    "userId": int(p["userId"]) if p.get("userId") is not None else None,
                    "isBot": is_b,
                    "name": str(p.get("name", f"Player {s_idx + 1}")),
                    "color": normalize_cart_color(p.get("color"), "Z3"),
                    "finalScore": int(p.get("cash", 0)),
                    "rank": rank_by_idx.get(s_idx, i + 1),
                    "won": won_by_idx.get(s_idx, bool(winner and p.get("name") == winner)),
                }
            )
        comp_players.sort(key=lambda x: (x["rank"], x["seatIndex"]))
        cg_ref.set(
            {
                "gameId": game_id,
                "gameName": str(g_data.get("name") or f"Convivium {game_id}"),
                "winnerName": winner,
                "season": str(state.get("season") or "Fall"),
                "completedAt": now,
                "standingsJson": json.dumps(standings) if isinstance(standings, list) else None,
                "humanCount": human_cnt,
                "participantUserIds": sorted(set(affected_uids)),
                "players": comp_players,
            }
        )
        _recompute_firestore_user_stats(fs, affected_uids)
    else:
        cg_snap = cg_ref.get()
        if cg_snap.exists or was_Already_Finished:
            prev_uids = list(cg_snap.to_dict().get("participantUserIds", [])) if cg_snap.exists else []
            if cg_snap.exists:
                cg_ref.delete()
            _recompute_firestore_user_stats(fs, affected_uids + prev_uids)


def get_leaderboard() -> List[Dict[str, Any]]:
    fs = _ensure_firebase()
    mp_docs = list(fs.collection("nm_completed_games").where("humanCount", ">=", 2).stream())
    stats_by_uid: Dict[int, Dict[str, int]] = {}
    for d in mp_docs:
        cd = d.to_dict()
        for p in (cd.get("players") or []):
            uid = p.get("userId")
            if uid is not None and not p.get("isBot"):
                uid_i = int(uid)
                st = stats_by_uid.setdefault(uid_i, {"gamesPlayed": 0, "gamesWon": 0, "bestWealth": 0})
                st["gamesPlayed"] += 1
                if p.get("won"):
                    st["gamesWon"] += 1
                st["bestWealth"] = max(st["bestWealth"], int(p.get("finalScore") or 0))

    rows = []
    for uid_i, st in stats_by_uid.items():
        u_snap = fs.collection("nm_users").document(str(uid_i)).get()
        if not u_snap.exists:
            continue
        ud = u_snap.to_dict()
        rows.append(
            {
                "userId": uid_i,
                "displayName": str(ud.get("displayName") or ud["username"]),
                "preferredColor": normalize_cart_color(ud.get("preferredColor"), "Z1"),
                "gamesPlayed": st["gamesPlayed"],
                "gamesWon": st["gamesWon"],
                "bestWealth": st["bestWealth"],
            }
        )
    rows.sort(key=lambda r: (-r["gamesWon"], -r["bestWealth"], -r["gamesPlayed"], r["userId"]))
    return rows[:20]


def get_user_completed_games(user_id: int) -> List[Dict[str, Any]]:
    fs = _ensure_firebase()
    uid = int(user_id)
    docs = list(fs.collection("nm_completed_games").where("participantUserIds", "array_contains", uid).stream())
    items = [d.to_dict() for d in docs]
    items.sort(key=lambda c: (int(c.get("completedAt", 0)), str(c.get("gameId", ""))), reverse=True)

    results = []
    for cg in items:
        gid = str(cg["gameId"])
        players = list(cg.get("players") or [])
        board_exists = fs.collection("nm_games").document(gid).get().exists
        standings = json.loads(cg["standingsJson"]) if cg.get("standingsJson") else None
        user_p = next((p for p in players if p.get("userId") == uid), None)
        results.append(
            {
                "gameId": gid,
                "gameName": cg.get("gameName", ""),
                "winnerName": cg.get("winnerName"),
                "season": cg.get("season", "Fall"),
                "completedAt": int(cg.get("completedAt") or 0),
                "userWon": bool(user_p and user_p.get("won")),
                "userRank": int(user_p["rank"]) if user_p and "rank" in user_p else None,
                "userFinalScore": int(user_p["finalScore"]) if user_p and "finalScore" in user_p else None,
                "canReopenBoard": board_exists,
                "standings": standings,
                "players": players,
            }
        )
    return results


def terminate_game(game_id: str, user: Dict[str, Any]) -> Tuple[bool, str]:
    fs = _ensure_firebase()
    g_ref = fs.collection("nm_games").document(game_id)
    snap = g_ref.get()
    if not snap.exists:
        return False, "Game not found."
    g_data = snap.to_dict()
    is_host = g_data.get("hostUserId") == user.get("id")
    is_admin = bool(user.get("isAdmin"))
    if not is_host and not is_admin:
        return False, "Only the player who created this game or an administrator can terminate it."
    g_ref.delete()
    return True, f"Terminated game '{g_data.get('name', game_id)}'."
