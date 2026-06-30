# Hosting MR. Assistant (AIO bot) on a Panel

This guide covers deploying the bot on a **hosting panel** (Pterodactyl / Pelican —
the kind most Discord-bot hosts use, e.g. Sparked, Bloom, Nodactyl, etc.). The
steps are the same idea on any Node host; panel-specific bits are called out.

> The bot now bundles: SellAuth (vouches/purchases), tickets, statuses, logging,
> moderation, the **auto-moderation system** (`automod/`), and the **availability
> responder** (`services/availability.js`).

---

## 0. The one thing people get wrong: Node version

This bot uses Node's built-in **`node:sqlite`**, which requires **Node v22.5 or
newer** (v24 recommended). It has **no** native build step, so you do **not**
need Python or build tools — but you **must** pick a new-enough Node image.

- On Pterodactyl: use a **Node.js 22 or 24** egg/Docker image
  (e.g. `ghcr.io/parkervcp/yolks:nodejs_24`). Node 18/20 will crash on startup
  with `Cannot find module 'node:sqlite'` / `DatabaseSync is not a constructor`.
- Verify in the panel console: `node -v` → must be ≥ `v22.5.0`.

---

## 1. Get the files onto the panel

Pick one:

**A. Upload a zip (simplest)**
1. Zip the project folder **without** `node_modules`, `.env`, `data/`, and `logs/`.
2. In the panel → **File Manager** → upload the zip → right-click → **Unarchive**.

**B. Git (recommended for updates)**
1. Push this repo to a private GitHub repo.
2. Panel → **Startup** (or a Git plugin) → set the repo URL, or in the console:
   ```bash
   git clone https://<token>@github.com/you/your-repo.git .
   ```

Either way the panel's working directory should contain `index.js`,
`package.json`, `commands/`, `events/`, `automod/`, `services/`, etc.

---

## 2. Configuration (environment variables)

The bot reads secrets from environment variables (loaded from `.env`). On a panel
you have two options — **use one**:

**A. Panel "Startup / Variables" tab** — add each variable there (preferred; the
panel injects them as real env vars). Add:

| Variable | Value |
| --- | --- |
| `DISCORD_TOKEN` | MR. Assistant bot token |
| `DISCORD_CLIENT_ID` | MR. Assistant application ID |
| `ENCRYPTION_KEY` | 64 hex chars (32 bytes) — your existing key (used to encrypt the SellAuth API key) |
| `DISCORD_GUILD_ID` | (optional) a guild ID for instant command registration |
| `DISCORD_LIVE_GUILD_ID` | (optional) second guild |
| `LOG_CHANNEL_ID` | `1516971063173447790` (auto-mod default log channel) |
| `LOG_LEVEL` | `info` |

**B. Upload a `.env` file** into the working directory with the same keys
(File Manager → New File → `.env`). Keep it private — never commit it.

> ⚠️ Reuse your **existing `ENCRYPTION_KEY`** — if it changes, the stored SellAuth
> API key can't be decrypted and you'll have to re-run `/setapikey`.

---

## 3. Install dependencies

Most panels run the **install command** automatically on (re)install, or you can
run it once in the console:

```bash
npm install --omit=dev
```

This installs `discord.js` and `dotenv` only — no compilation. (`node:sqlite` is
built into Node, and strike-decay uses a plain timer, so there are no extra deps.)

---

## 4. Startup command

Set the panel's **Startup Command** to:

```bash
node index.js
```

(Equivalent to `npm start`.) Do **not** use `npm run dev` in production — that
restarts on file changes.

---

## 5. Enable the privileged intents (required)

In the **Discord Developer Portal → your MR. Assistant app → Bot → Privileged
Gateway Intents**, turn ON **both**:

- ✅ **Server Members Intent** — auto-role + auto-mod join checks (anti-raid,
  account-age, nicknames)
- ✅ **Message Content Intent** — auto-mod content filters + availability responder

The bot is resilient: if an intent is off it still boots and logs a warning, with
the matching features dormant — so it won't crash, but auto-mod won't work until
both are on. Also confirm the bot's **role permissions** in the server include:
**Manage Messages, Moderate Members, Ban Members, Kick Members, Manage Nicknames,
Manage Server** (anti-raid), and **View/Send/Embed** in the channels it watches.

---

## 6. Register the slash commands

Run **once** from the panel console after the files are up (there are 44 commands
now, including the 8 new auto-mod/availability ones):

```bash
node deploy-commands.js            # → DISCORD_GUILD_ID (instant)
# or, for every server (~1 hour to appear):
node deploy-commands.js --global
```

Re-run this only when commands are **added/renamed/changed**.

---

## 7. Persistent storage (don't lose your data)

The bot keeps two SQLite files in **`data/`**:

- `data/bot.sqlite` — SellAuth config, tickets, statuses, roles, logs
- `data/automod.sqlite` — strikes, blocklist, allowlist, module toggles, test mode, availability state

On most panels the whole server directory persists across restarts, so nothing
extra is needed. If your host wipes the directory on reinstall, **back up
`data/`** (and exclude it from any auto-clean). WAL files (`*.sqlite-wal` /
`-shm`) live alongside and are normal.

---

## 8. Start & verify

Hit **Start**. A healthy boot logs:

```
[INFO] Starting MR. Assistant (AIO) bot…
[INFO] Loaded 44 commands.
[INFO] Loaded 8 events.
[INFO] Logged in as MR. Assistant#6625 — ...
```

If you see a warning about MESSAGE CONTENT / SERVER MEMBERS being off, fix the
intents (step 5) and restart. Then in Discord:

- `/automod status` — confirm modules are listed
- `/availability preview` — see the availability card
- post a violation from a **non-staff** account (staff are exempt) — it should be
  deleted + logged in <#1516971063173447790>

Use **`/testing enabled:True`** first to dry-run (delete + DM, but no strikes) and
test on your own account, then **`/testing enabled:False`** for real enforcement.

---

## 9. Keeping it online

Panels auto-restart the process if it exits (and on node crashes the bot's global
handlers log and keep running). Enable the panel's **"auto-restart / always on"**
option if available. No PM2 needed inside the container.

---

## 10. Updating later

1. Upload changed files (or `git pull`).
2. `npm install --omit=dev` (only if dependencies changed).
3. `node deploy-commands.js` (only if commands changed).
4. **Restart** from the panel.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Cannot find module 'node:sqlite'` / `DatabaseSync` error | Node too old — switch the egg/image to **Node ≥ 22.5** (24 recommended). |
| Boot warns "MESSAGE CONTENT intent is OFF" | Enable Message Content in the Developer Portal, restart. |
| Auto-mod deletes nothing | You're testing as staff/owner (exempt) — use a normal account, or `/testing`. |
| Slash commands missing | Run `node deploy-commands.js`; for global give it up to ~1h. |
| "Missing Access/Permissions" in logs | Grant the bot the role permissions listed in step 5. |
| Data resets on reinstall | Back up `data/` — your host wipes the directory; restore it after. |
| Can't decrypt SellAuth key after move | `ENCRYPTION_KEY` changed — set the original value, or re-run `/setapikey`. |
| **Restarted but still old code / wrong command count** | The egg's **USER UPLOADED FILES** variable is ON (`1`) → it skips the git clone, so the panel never pulls from GitHub. See the section below. |

---

## 11. Pterodactyl (parkervcp Node.js "git" egg) — exact settings

This egg can auto-deploy from GitHub. Set these **Variables**:

| Variable | Value |
| --- | --- |
| **Git Repo Address** | `https://github.com/unhingeddev/mr-assistant-bot` |
| **Install Branch** | `main`  ← don't leave this blank |
| **User Uploaded Files** | **`0` / OFF**  ← if ON, it SKIPS the git clone (this is the #1 "it won't update" cause) |
| **Auto Update** | `1` / ON  → `git pull` on every restart |
| **Git Username** | `unhingeddev` |
| **Git Access Token** | a fine-grained PAT with **read** access to this repo |
| **Main File** | `index.js` |
| **Docker Image** | Node.js **22 or 23/24** (needs ≥ 22.5 for `node:sqlite`) |

### Going from old/uploaded files → GitHub (the fix for "still 36 commands")

> ⚠️ Reinstall **wipes the disk**. Back up `data/` first or you lose tickets + the encrypted SellAuth key.

1. **Stop** the server.
2. File Manager → **download `data/` and `.env`**.
3. Set **User Uploaded Files = 0 (OFF)** and **Install Branch = `main`**.
4. *(Cleanest)* delete the leftover old files in File Manager.
5. **Settings → Reinstall Server** (clones the repo using the token).
6. Re-upload **`data/`** (and `.env`, or set the env vars in the Startup/Variables tab).
7. Enable **Message Content** + **Server Members** intents on the app.
8. **Start** → expect `Starting MR. Assistant (AIO) bot…` and `Loaded 46 commands.`

### Registering the slash commands on the panel

The bot doesn't self-register. Run the deploy script once by temporarily swapping the entry point:

1. Set **Main File = `deploy-commands.js`**, **Additional Arguments = `--all`** → **Start**.
2. Wait for `Registering 46 command(s)… Done`, then **Stop**.
3. Set **Main File** back to **`index.js`**, clear Additional Arguments → **Start**.

After this, **Auto Update** keeps the panel in sync — push to `main` and restart to deploy.
