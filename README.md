# Night Merchant: All Roads Lead to Rome (211 A.D.)

**Live Web Portal:** `https://dashiellrenaud.com/nightmerchant`

*Night Merchant: All Roads Lead to Rome* is a digital tabletop board game of commerce, smuggling, and Severan court intrigue set in Ostia and Rome during the volatile co-reign of Emperors Caracalla and Geta in **211 A.D.**

---

## Multiplayer & Expedition Invitations

Players register or sign in via the **Collegium Mercatorum** portal (Username/Email + Password or Google Sign-In via Firebase Authentication) and can host expeditions with 2–6 total merchants (any mix of human players and AI syndicate rivals):

1. **Open Invitation (`open`)**: Any signed-in player can claim an open human merchant seat from the lobby list.
2. **Invite Only (`invite_only`)**:
   - The host specifies the `@username`(s) of invited players when creating the lobby (or adds additional `@username` invites before launch).
   - The server looks up the email address on file for each invited player and dispatches an email invitation via EmailJS with a direct join link (`https://dashiellrenaud.com/nightmerchant/?game=<id>`) without ever exposing player email addresses to other clients.
   - Only invited players (and the host) can claim human seats in that lobby.
3. **Post-Start Lockout**: In **both** Open Invitation and Invite-Only modes, once the host starts the game (`status != "lobby"`), no additional players can join.

---

## Architecture

- **Frontend (`public/`)**: Static vanilla ES6+ SPA (`index.html`, `app.js`, `styles.css`, `config.js`, `assets/`) using subpath-safe relative URLs so it runs identically at `/` (local dev) and `/nightmerchant/` (GitHub Pages at `dashiellrenaud.com/nightmerchant`).
- **Authoritative Game & Auth Server (`src/`)**:
  - `src/server.py` — HTTP API server with CORS allow-listing, CSRF protection, Firebase ID token verification, and hidden-information filtering (opponents' secret Influence hands, hidden Missiones, and raw emails never leave the server).
  - `src/game_engine.py` — Complete rules engine, Ostia market supply/demand simulator, Rome encounter resolver, Winter Reckoning scoring, and AI bot personas.
  - `src/firebase_db.py` — Production persistence & auth adapter backed by **Firebase Authentication** and **Cloud Firestore** (`NIGHTMERCHANT_USE_FIREBASE=1` or `FIREBASE_PROJECT_ID`).
  - `src/db.py` — Zero-config local SQLite fallback for offline local development.
  - `src/email_service.py` — Server-side EmailJS REST dispatcher for Invite-Only game notifications.

---

## Local Development

```bash
# Run locally with SQLite fallback on http://127.0.0.1:8080
python3 src/server.py
```

---

## Production Deployment (Firebase + Cloud Run + GitHub Pages)

### 1. Environment Variables (Cloud Run Backend)

| Variable | Description |
| :--- | :--- |
| `NIGHTMERCHANT_USE_FIREBASE` | Set to `1` to use Firebase Auth + Cloud Firestore |
| `FIREBASE_PROJECT_ID` | Firebase / Google Cloud Project ID (`nightmerchant-f183d`) |
| `FIREBASE_WEB_API_KEY` | Restricted Firebase Web API Key (supplied at runtime via `GET /api/auth/me` and used for password login verification; never commit `AIza...` keys to `public/config.js`) |
| `NIGHTMERCHANT_PUBLIC_URL` | `https://dashiellrenaud.com/nightmerchant` |
| `NIGHTMERCHANT_ALLOWED_ORIGINS` | Optional comma-separated extra CORS origins |
| `EMAILJS_SERVICE_ID` | EmailJS Service ID for Invite-Only game emails |
| `EMAILJS_TEMPLATE_ID` | EmailJS Template ID (`{{to_email}}`, `{{subject}}`, `{{message}}`) |
| `EMAILJS_PUBLIC_KEY` | EmailJS Public Key (User ID) |
| `EMAILJS_PRIVATE_KEY` | EmailJS Private Key (Access Token for server-side API calls) |

Deploy the backend container to Cloud Run:

```bash
gcloud run deploy nightmerchant-api \
  --source . \
  --region us-west2 \
  --allow-unauthenticated \
  --set-env-vars="NIGHTMERCHANT_USE_FIREBASE=1,FIREBASE_PROJECT_ID=<PROJECT_ID>,FIREBASE_WEB_API_KEY=<RESTRICTED_WEB_API_KEY>,NIGHTMERCHANT_PUBLIC_URL=https://dashiellrenaud.com/nightmerchant,EMAILJS_SERVICE_ID=<SERVICE_ID>,EMAILJS_TEMPLATE_ID=<TEMPLATE_ID>,EMAILJS_PUBLIC_KEY=<PUBLIC_KEY>,EMAILJS_PRIVATE_KEY=<PRIVATE_KEY>"
```

### 2. Frontend Configuration & GitHub Pages Sync

1. Populate `apiBaseUrl` (your Cloud Run URL) and non-secret `firebaseConfig` project identifiers (`projectId`, `authDomain`, `appId` — **never** `apiKey`) in `public/config.js`.
2. Sync `public/` into `dashiellrenaud_site/nightmerchant` (omit `--preserve-config` so `config.js` is updated):
   ```bash
   python3 scripts/sync_to_site.py
   ```
3. Commit and push `dashiellrenaud_site` to publish live at `https://dashiellrenaud.com/nightmerchant`.

---

## License

Copyright (c) 2026 Dashiell Renaud.

This work is licensed under the **Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International License (CC BY-NC-ND 4.0)**. See [`LICENSE`](./LICENSE) or visit <https://creativecommons.org/licenses/by-nc-nd/4.0/> for full terms.
