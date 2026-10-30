# Copyright (c) 2026 Dashiell Renaud (https://dashiellrenaud.com)
# Licensed under Creative Commons Attribution-NonCommercial-NoDerivatives 4.0
# International (CC BY-NC-ND 4.0): https://creativecommons.org/licenses/by-nc-nd/4.0/
# SPDX-License-Identifier: CC-BY-NC-ND-4.0

"""
Storage selector for Night Merchant:
- Uses Firebase Authentication + Cloud Firestore (firebase_db) when FIREBASE_PROJECT_ID is set.
- Uses local SQLite (db) in local development and automated integration tests.
"""

import os
from types import ModuleType


def is_firebase_enabled() -> bool:
    return bool(os.getenv("FIREBASE_PROJECT_ID", "").strip() or os.getenv("NIGHTMERCHANT_USE_FIREBASE", "").strip() == "1")


def get_backend() -> ModuleType:
    if is_firebase_enabled():
        import firebase_db
        return firebase_db
    import db
    return db
