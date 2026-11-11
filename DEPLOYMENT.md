# Night Merchant Deployment Guide

Production consists of **two separately deployed pieces**:

1. **Frontend (Static Web App)** — Hosted on GitHub Pages at **`https://dashiellrenaud.com/nightmerchant`** from the separate website repository (**`dashiellrenaud_site`**, subdirectory `nightmerchant/`).
2. **Backend (Game & Auth API)** — Hosted on Google Cloud Run (`nightmerchant-api`, region `us-west2`) at **`https://nightmerchant-api-208043966891.us-west2.run.app`** directly from this repository (**`NightMerchant`**).

> **Why running `python3 scripts/sync_to_site.py` alone does not deploy changes:**
> `scripts/sync_to_site.py` only performs a **local file copy** on your computer from `NightMerchant/public/` (+ `LICENSE`) into `../dashiellrenaud_site/nightmerchant/`. It does **not** run `git commit` / `git push` in either repository, and it does **not** deploy `src/` backend updates to Cloud Run.

---

## Which Terminal Runs What?

| Step | Where to Run | Purpose |
| :--- | :--- | :--- |
| **1. Bump Version (if frontend changed)** | **Local Console** (`NightMerchant/`) | Updates asset query strings and `version.json` so browsers/mobile auto-reload |
| **2. Commit & Push Source Repo** | **Local Console** (`NightMerchant/`) | Pushes `public/`, `src/`, and docs to `github.com:renaudd/NightMerchant.git` |
| **3. Sync & Push Website Repo** | **Local Console** (`NightMerchant/` → website repo) | Copies `public/` into `dashiellrenaud_site/nightmerchant/` and pushes to GitHub Pages |
| **4. Pull & Redeploy Backend** | **Google Cloud Shell** (`~/NightMerchant`) | Pulls latest `main` and builds/deploys the Cloud Run container |
| **5. Verify Live Endpoints** | **Local Console** (or browser) | Confirms GitHub Pages version and Cloud Run `/api/health` |

---

## Values You Provide on Each Deployment

Before running any commands, decide on these values:

### 1. `<NEW_VERSION>` (Frontend Version Number)
- **Format:** Incrementing integer string (for example, `"55"` → `"56"`). Must match `^[A-Za-z0-9._-]{1,32}$`.
- **When to bump it:** Only bump the version **once per unpublished release** when changing anything inside `public/` (`index.html`, `app.js`, `styles.css`, `config.js`, `assets/`, `data/`).
  - Check your **local** version vs. **live** production version first:
    ```bash
    # Local working tree version
    cat public/version.json
    # Live website version currently deployed
    curl -fsS https://dashiellrenaud.com/nightmerchant/version.json
    ```
  - **If local `public/version.json` is ALREADY higher than live production** (for example, local says `"55"` while live still serves `"53"`), **do NOT bump it again** — deploy `"55"` as-is.
  - **If local `public/version.json` equals live production**, bump it by 1 before committing/syncing.
  - If you only changed Python backend code (`src/`) and did not touch `public/`, you can skip bumping `<NEW_VERSION>` and skip Part 2 (Website Sync).
- **Where `<NEW_VERSION>` must be updated (when a bump is needed):**
  1. [`public/index.html`](public/index.html) — update **all 5** occurrences (the `<meta name="nm-version" content="...">` tag and `?v=...` query params on `styles.css`, `config.js`, `version-check.js`, and `app.js`).
  2. [`public/version.json`](public/version.json) — update `{"version": "<NEW_VERSION>"}`.
  3. *(Only if `public/data/cards_catalog.json` changed)* [`public/app.js`](public/app.js) inside `ensureCardsCatalogLoaded()` — update `./data/cards_catalog.json?v=<NEW_VERSION>`.
  - *(Example helper in Local Console — replace `<OLD_V>` and `<NEW_V>` with your actual old/new numbers:)*
    ```bash
    OLD_V=<OLD_VERSION>
    NEW_V=<NEW_VERSION>
    sed -i '' "s/content=\"${OLD_V}\"/content=\"${NEW_V}\"/g; s/?v=${OLD_V}/?v=${NEW_V}/g" public/index.html
    printf '{\n  "version": "%s"\n}\n' "${NEW_V}" > public/version.json
    git diff public/index.html public/version.json
    ```

### 2. `<COMMIT_MESSAGE>`
- Keep the message short, descriptive, and imperative (e.g., `"Update scout/trash rules, encounter deck odds, and rulebook v55"`).
- You can use the same `<COMMIT_MESSAGE>` in `NightMerchant` and `dashiellrenaud_site`, or prefix the website commit with `"NightMerchant v<VERSION>: <summary>"`.

### 3. `<SITE_REPO_PATH>` (Local Website Repository Location)
- `scripts/sync_to_site.py` defaults to `../dashiellrenaud_site` relative to `NightMerchant` (so `../dashiellrenaud_site/nightmerchant`).
- If your local clone of the website repo has a different folder name or path, pass `--target <SITE_REPO_PATH>/nightmerchant` when running `sync_to_site.py` and `cd` into `<SITE_REPO_PATH>` instead of `../dashiellrenaud_site`.

---

## Step-by-Step Deployment Commands

### Part 1 — **Local Console** (Commit & Push `NightMerchant`)

Run these commands on your Mac inside the `NightMerchant` directory:

```bash
cd /Users/rend/Development/NightMerchant
```

1. *(Optional but recommended)* Check Python syntax and review changed/untracked files:
   ```bash
   python3 -m py_compile src/game_engine.py src/server.py
   git status
   ```
   - Make sure local runtime artifacts (`night_merchant.db`, `server.log`, `.DS_Store`) are ignored and **not** staged.
   - If you regenerated the card catalog (`public/data/cards_catalog.json`), make sure it is included in `git add`.

2. Update `<NEW_VERSION>` in [`public/index.html`](public/index.html) and [`public/version.json`](public/version.json) if you modified any files under `public/` (see [Values You Provide on Each Deployment](#values-you-provide-on-each-deployment)).

3. Stage, commit, and push **`NightMerchant`** to GitHub (`origin main`):
   ```bash
   git add NightMerchant\ Rule\ Book.md public/ src/ scripts/ README.md DEPLOYMENT.md
   # Or inspect `git status` and stage specific modified/new paths cleanly:
   # git add <files...>
   git status
   git commit -m "<COMMIT_MESSAGE>"
   git push origin main
   ```

---

### Part 2 — **Local Console** (Sync & Push Frontend to Website Repo `dashiellrenaud_site`)

Still in your **Local Console** inside `/Users/rend/Development/NightMerchant`:

1. Run [`scripts/sync_to_site.py`](scripts/sync_to_site.py):
   - **Standard sync** (overwrites target `nightmerchant/` cleanly using `NightMerchant/public/config.js`):
     ```bash
     python3 scripts/sync_to_site.py
     ```
   - **If your website repo lives at a custom path** (replace `<SITE_REPO_PATH>`):
     ```bash
     python3 scripts/sync_to_site.py --target <SITE_REPO_PATH>/nightmerchant
     ```
   - **If the website repo's existing `nightmerchant/config.js` must not be overwritten**, add `--preserve-config`:
     ```bash
     python3 scripts/sync_to_site.py --preserve-config
     ```
   - Confirm the output prints the expected target path and matching version, for example:
     `[sync_to_site] Synced .../NightMerchant/public -> .../dashiellrenaud_site/nightmerchant (version=56)`

2. Move into your local website repository, verify the copied changes, commit, and **push to GitHub**:
   ```bash
   cd ../dashiellrenaud_site   # or: cd <SITE_REPO_PATH>
   git status
   git branch --show-current
   ```
   Make sure `git status` shows modified/added files under `nightmerchant/` (and `.nojekyll` if created), then commit and push to the website repo's remote branch (usually `main` or `gh-pages`):
   ```bash
   git add -A nightmerchant .nojekyll
   git commit -m "NightMerchant v<NEW_VERSION>: <COMMIT_MESSAGE>"
   git push
   ```
   > Wait ~1–2 minutes for GitHub Pages to finish building and publishing `https://dashiellrenaud.com/nightmerchant/`.

---

### Part 3 — **Google Cloud Shell** (Pull `NightMerchant` & Redeploy Cloud Run Backend)

Run these commands in **Google Cloud Shell** (needed whenever `src/`, `Dockerfile`, `requirements.txt`, or `public/version.json` changed — and required if any game rules, decks, or server endpoints changed):

1. Open Google Cloud Shell and enter your cloned `NightMerchant` folder:
   - **First time in a new Cloud Shell environment:**
     ```bash
     git clone https://github.com/renaudd/NightMerchant.git
     cd NightMerchant
     ```
   - **Normal deployments (already cloned in Cloud Shell):**
     ```bash
     cd ~/NightMerchant
     git fetch origin
     git checkout main
     git pull origin main
     git log -1 --oneline
     ```
   Confirm `git log -1 --oneline` displays the commit you just pushed in Part 1.

2. Verify you are targeting the correct Google Cloud project:
   ```bash
   gcloud config set project nightmerchant-f183d
   ```

3. **Redeploy Cloud Run (`nightmerchant-api`):**
   - **Normal code redeploy** (preserves all existing Cloud Run environment variables — Firebase keys, EmailJS keys, Google Client ID, etc.):
     ```bash
     gcloud run deploy nightmerchant-api \
       --source . \
       --region us-west2 \
       --allow-unauthenticated
     ```
   > **CRITICAL:** Do **NOT** pass `--set-env-vars` on a routine redeploy unless you pass *every* variable below, because `--set-env-vars` replaces the entire env var list and will wipe secrets (`FIREBASE_WEB_API_KEY`, `EMAILJS_*`, etc.). To add or change just one variable later, use `--update-env-vars="KEY=VALUE"` instead.

   - **Reference only — Initial setup or updating all environment variables:**
     ```bash
     gcloud run deploy nightmerchant-api \
       --source . \
       --region us-west2 \
       --allow-unauthenticated \
       --set-env-vars="NIGHTMERCHANT_USE_FIREBASE=1,FIREBASE_PROJECT_ID=nightmerchant-f183d,FIREBASE_WEB_API_KEY=<RESTRICTED_WEB_API_KEY>,NIGHTMERCHANT_PUBLIC_URL=https://dashiellrenaud.com/nightmerchant,EMAILJS_SERVICE_ID=<SERVICE_ID>,EMAILJS_TEMPLATE_ID=<TEMPLATE_ID>,EMAILJS_PUBLIC_KEY=<PUBLIC_KEY>,EMAILJS_PRIVATE_KEY=<PRIVATE_KEY>"
     ```
     Optional environment variables supported by [`src/server.py`](src/server.py) and [`src/firebase_db.py`](src/firebase_db.py): `GOOGLE_CLIENT_ID`, `NIGHTMERCHANT_ALLOWED_ORIGINS`, `NIGHTMERCHANT_REPLY_TO`, `FIREBASE_CLIENT_API_KEY`, `FIREBASE_SERVER_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_APP_ID`.

---

## Part 4 — Post-Deployment Verification (Local Console or Browser)

Run these quick checks after Part 2 (GitHub Pages) and Part 3 (Cloud Run) finish:

```bash
# 1. Confirm live GitHub Pages site serves your new version
curl -fsS https://dashiellrenaud.com/nightmerchant/version.json

# 2. Confirm Cloud Run backend is healthy and connected to Firebase + EmailJS
curl -fsS https://nightmerchant-api-208043966891.us-west2.run.app/api/health

# 3. Confirm Cloud Run also serves matching public/version.json
curl -fsS https://nightmerchant-api-208043966891.us-west2.run.app/version.json
```

Expected outputs:
- GitHub Pages `version.json` returns `{"version": "<NEW_VERSION>"}`.
- Cloud Run `/api/health` returns `{"ok": true, "storage": "firebase", "emailConfigured": true}`.
- Existing browser tabs running older builds will automatically detect the mismatch in `version.json` via [`public/version-check.js`](public/version-check.js) and prompt/reload into the new bundle.

---

## Troubleshooting

- **"`python3 scripts/sync_to_site.py` succeeded, but nothing changed in my website repo / GitHub":**
  1. Check where `sync_to_site.py` actually wrote files in the command output line `[sync_to_site] Synced ... -> <TARGET_PATH>`. If your website repo on disk is not named `../dashiellrenaud_site` right next to `NightMerchant`, the script created/updated `../dashiellrenaud_site/nightmerchant` instead of your real website repo! Re-run with `--target /actual/path/to/website-repo/nightmerchant` and clean up any unintended sibling folder if needed.
  2. Inside the real website repo, verify `git status` and ensure you ran `git add`, `git commit`, and `git push` (not just the Python copy script).
  3. Check `git remote -v` and `git branch -vv` in the website repo to confirm you pushed to the branch GitHub Pages builds from.

- **"Website looks updated, but game logic/cards/bugs behave like the old version":**
  - GitHub Pages only hosts static files (`public/`). Game rules (`src/game_engine.py`), decks (`src/data/decks.json`), and HTTP handlers (`src/server.py`) run on Cloud Run — run **Part 3 in Google Cloud Shell** (`git pull origin main` + `gcloud run deploy ...`).

- **"My Cloud Run service URL changed":**
  - Update `apiBaseUrl` in [`public/config.js`](public/config.js), bump `<NEW_VERSION>`, and repeat Parts 1 and 2 (omitting `--preserve-config`).
