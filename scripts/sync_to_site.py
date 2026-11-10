#!/usr/bin/env python3
# Night Merchant: All Roads Lead to Rome (211 A.D.)
# Copyright (c) 2026 Dashiell Renaud.
#
# Licensed under the Creative Commons Attribution-NonCommercial-NoDerivatives 4.0
# International License (CC BY-NC-ND 4.0).
# https://creativecommons.org/licenses/by-nc-nd/4.0/

"""Syncs the Night Merchant static web frontend (public/ + LICENSE) to dashiellrenaud_site/nightmerchant."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys


REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PUBLIC_DIR = os.path.join(REPO_ROOT, "public")
LICENSE_PATH = os.path.join(REPO_ROOT, "LICENSE")
DEFAULT_SITE_TARGET = os.path.abspath(
    os.path.join(REPO_ROOT, "..", "dashiellrenaud_site", "nightmerchant")
)

SKIP_NAMES = {".DS_Store", "Thumbs.db"}


def _ignore_junk(_dir: str, names: list[str]) -> set[str]:
    return {n for n in names if n in SKIP_NAMES}


def _extract_index_version(index_html_path: str) -> str | None:
    if not os.path.isfile(index_html_path):
        return None
    with open(index_html_path, "r", encoding="utf-8") as fh:
        html_text = fh.read()
    m = re.search(r"app\.js\?v=([A-Za-z0-9._-]{1,32})", html_text)
    if m:
        return m.group(1)
    m_meta = re.search(
        r'<meta\s+name=["\']nm-version["\']\s+content=["\']([A-Za-z0-9._-]{1,32})["\']',
        html_text,
        re.IGNORECASE,
    )
    return m_meta.group(1) if m_meta else None


def sync_public_to_site(target_dir: str, preserve_config: bool = False) -> str | None:
    if not os.path.isdir(PUBLIC_DIR):
        raise FileNotFoundError(f"Missing public directory: {PUBLIC_DIR}")

    saved_config_bytes = None
    existing_cfg_path = os.path.join(target_dir, "config.js")
    if preserve_config and os.path.isfile(existing_cfg_path):
        with open(existing_cfg_path, "rb") as f:
            saved_config_bytes = f.read()

    if os.path.isdir(target_dir):
        shutil.rmtree(target_dir)

    os.makedirs(os.path.dirname(target_dir), exist_ok=True)
    shutil.copytree(PUBLIC_DIR, target_dir, ignore=_ignore_junk)

    if os.path.isfile(LICENSE_PATH):
        shutil.copy2(LICENSE_PATH, os.path.join(target_dir, "LICENSE"))

    if saved_config_bytes is not None:
        with open(existing_cfg_path, "wb") as f:
            f.write(saved_config_bytes)

    detected_version = _extract_index_version(os.path.join(target_dir, "index.html"))
    if detected_version:
        version_json_path = os.path.join(target_dir, "version.json")
        with open(version_json_path, "w", encoding="utf-8") as vf:
            json.dump({"version": detected_version}, vf, indent=2)
            vf.write("\n")

    site_root = os.path.dirname(os.path.abspath(target_dir))
    if os.path.isdir(site_root):
        nojekyll_path = os.path.join(site_root, ".nojekyll")
        if not os.path.exists(nojekyll_path):
            with open(nojekyll_path, "w", encoding="utf-8") as f:
                f.write("")

    return detected_version


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync Night Merchant web frontend into dashiellrenaud_site/nightmerchant."
    )
    parser.add_argument(
        "--target",
        default=DEFAULT_SITE_TARGET,
        help=f"Destination directory (default: {DEFAULT_SITE_TARGET})",
    )
    parser.add_argument(
        "--preserve-config",
        action="store_true",
        help="Keep existing target config.js if already present in destination.",
    )
    args = parser.parse_args()

    target = os.path.abspath(args.target)
    synced_version = sync_public_to_site(target, preserve_config=args.preserve_config)
    v_note = f" (version={synced_version})" if synced_version else ""
    print(f"[sync_to_site] Synced {PUBLIC_DIR} -> {target}{v_note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
