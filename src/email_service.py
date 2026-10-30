# Copyright (c) 2026 Dashiell Renaud (https://dashiellrenaud.com)
# Licensed under Creative Commons Attribution-NonCommercial-NoDerivatives 4.0
# International (CC BY-NC-ND 4.0): https://creativecommons.org/licenses/by-nc-nd/4.0/
# SPDX-License-Identifier: CC-BY-NC-ND-4.0

import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List

EMAILJS_API_URL = "https://api.emailjs.com/api/v1.0/email/send"
DEFAULT_PUBLIC_URL = "https://dashiellrenaud.com/nightmerchant/"

logger = logging.getLogger("nightmerchant.email")


def _get_emailjs_config() -> Dict[str, str]:
    return {
        "service_id": os.getenv("EMAILJS_SERVICE_ID", "").strip(),
        "template_id": os.getenv("EMAILJS_TEMPLATE_ID", "").strip(),
        "public_key": os.getenv("EMAILJS_PUBLIC_KEY", "").strip(),
        "private_key": os.getenv("EMAILJS_PRIVATE_KEY", "").strip(),
        "public_url": os.getenv("NIGHTMERCHANT_PUBLIC_URL", DEFAULT_PUBLIC_URL).strip() or DEFAULT_PUBLIC_URL,
        "reply_to": os.getenv("NIGHTMERCHANT_REPLY_TO", "noreply@dashiellrenaud.com").strip(),
    }


def is_email_configured() -> bool:
    cfg = _get_emailjs_config()
    return bool(cfg["service_id"] and cfg["template_id"] and cfg["public_key"])


def build_invite_email_payload(
    game_summary: Dict[str, Any],
    host_user: Dict[str, Any],
    recipient: Dict[str, Any],
    cfg: Dict[str, str],
) -> Dict[str, Any]:
    game_id = str(game_summary.get("id", ""))
    game_name = str(game_summary.get("name", "Night Merchant Convivium"))
    host_display = str(host_user.get("displayName") or host_user.get("username") or "A Fellow Merchant")
    host_username = str(host_user.get("username") or "")
    rec_display = str(recipient.get("displayName") or recipient.get("username") or "Merchant")
    rec_username = str(recipient.get("username") or "")
    to_email = str(recipient.get("email") or "").strip()

    base_url = cfg["public_url"].rstrip("/")
    invite_url = f"{base_url}/?game={urllib.parse.quote(game_id)}"

    subject = f'Night Merchant Invite: {host_display} invited you to "{game_name}"'
    body_text = (
        f"Salve, {rec_display} (@{rec_username})!\n\n"
        f'{host_display} (@{host_username}) has invited you to claim a seat in "{game_name}" '
        f"in Night Merchant: All Roads Lead to Rome (211 A.D.).\n\n"
        f"This table is Invite-Only: only invited merchants may claim an open seat, "
        f"and seats close as soon as the host starts the match.\n\n"
        f"Join the lobby here:\n{invite_url}\n\n"
        f"Sign in as @{rec_username} to claim your merchant cart.\n"
        f"— Collegium Mercatorum (211 A.D.)"
    )

    template_params = {
        "to_email": to_email,
        "email": to_email,
        "recipient_email": to_email,
        "to_name": rec_display,
        "recipient_name": rec_display,
        "recipient_username": rec_username,
        "from_name": "Night Merchant — Collegium Mercatorum",
        "host_name": host_display,
        "host_username": host_username,
        "game_name": game_name,
        "game_id": game_id,
        "invite_url": invite_url,
        "reply_to": cfg["reply_to"],
        "replyTo": cfg["reply_to"],
        "reply_email": cfg["reply_to"],
        "subject": subject,
        "message": body_text,
        "body": body_text,
        "content": body_text,
        "notification_type": "game_invite",
    }

    payload: Dict[str, Any] = {
        "service_id": cfg["service_id"],
        "template_id": cfg["template_id"],
        "user_id": cfg["public_key"],
        "template_params": template_params,
    }
    if cfg["private_key"]:
        payload["accessToken"] = cfg["private_key"]
    return payload


def send_game_invite_emails(
    game_summary: Dict[str, Any],
    host_user: Dict[str, Any],
    invited_recipients: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Dispatch invitation emails server-side via EmailJS REST API.
    Never logs or returns raw email addresses to preserve PII confidentiality.
    """
    cfg = _get_emailjs_config()
    configured = bool(cfg["service_id"] and cfg["template_id"] and cfg["public_key"])

    deliverable = [
        r
        for r in invited_recipients
        if isinstance(r.get("email"), str)
        and "@" in r["email"]
        and not r["email"].strip().lower().endswith("@roma.local")
    ]
    skipped_count = len(invited_recipients) - len(deliverable)

    if not deliverable:
        return {
            "configured": configured,
            "sentCount": 0,
            "skippedCount": skipped_count,
            "failedCount": 0,
        }

    if not configured:
        logger.info("EmailJS environment variables not configured; skipping live email dispatch for %d invite(s).", len(deliverable))
        return {
            "configured": False,
            "sentCount": 0,
            "skippedCount": len(invited_recipients),
            "failedCount": 0,
        }

    sent_count = 0
    failed_count = 0
    origin_hdr = "https://dashiellrenaud.com"

    for rec in deliverable:
        payload = build_invite_email_payload(game_summary, host_user, rec, cfg)
        raw_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            EMAILJS_API_URL,
            data=raw_bytes,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Origin": origin_hdr,
                "User-Agent": "NightMerchant/1.0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=8.0) as resp:
                if 200 <= resp.status < 300:
                    sent_count += 1
                else:
                    failed_count += 1
                    logger.warning("EmailJS invite dispatch returned HTTP %s for game %s.", resp.status, game_summary.get("id"))
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            failed_count += 1
            logger.warning("EmailJS invite dispatch failed for game %s (%s).", game_summary.get("id"), type(exc).__name__)

    return {
        "configured": True,
        "sentCount": sent_count,
        "skippedCount": skipped_count,
        "failedCount": failed_count,
    }
