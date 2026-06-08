# Deployment & Operations — SAIL-MIOM Backend

Operational reference that travels with the code. Infra: GitHub → EC2 (Ubuntu)
→ PM2 → Nginx → Let's Encrypt → `https://sail-miom.ddns.net`. For the full
server runbook see `BACKEND_DEPLOYMENT.md` (kept alongside the project).

---

## Deploy a new version (on EC2)

```bash
cd ~/apps/sail-miom-backend

# 1. Back up the live secrets FIRST — git pull can clobber an untracked .env
#    on some flows, and node_modules is no longer tracked.
cp .env ~/.env.sail-miom.bak

git pull origin main
npm ci                      # clean, lockfile-exact install (node_modules is git-ignored)
npx prisma generate
npx prisma migrate deploy
pm2 reload ecosystem.config.js   # or: pm2 restart sail-miom-backend
pm2 save
```

> If `migrate deploy` reports **P3009**, inspect with `npx prisma migrate status`,
> then resolve with `npx prisma migrate resolve --applied <name>` (tables already
> exist) or `--rolled-back <name>` (truly failed), and re-run `migrate deploy`.

---

## PM2 via the ecosystem file

`ecosystem.config.js` (repo root) is the canonical process definition.

```bash
mkdir -p logs                     # first time only; logs/ is git-ignored
pm2 start ecosystem.config.js     # first launch
pm2 reload ecosystem.config.js    # graceful reload on deploy
pm2 save                          # persist across reboots
pm2 logs sail-miom-backend        # tail logs (also in logs/pm2-*.log)
```

Key settings (see the file's comments for the full rationale):

| Setting | Value | Why |
|---|---|---|
| `instances` | `1` (fork) | **Must stay 1** — the in-process SLA cron would duplicate under cluster mode |
| `max_memory_restart` | `500M` | auto-restart on memory leak |
| `kill_timeout` | `11000` ms | matches the app's 10 s graceful-shutdown force-exit |
| `env.NODE_ENV` | `production` | PM2 wins over `.env`, guarding a misspelled value there |

---

## Health endpoint (DB-aware)

`GET /health` now performs a live `SELECT 1` against Postgres, so it reflects
**database availability**, not just process liveness.

**Healthy (HTTP 200):**

```bash
curl -i http://localhost:5000/health
# 200 OK
# {"status":"ok","service":"SAIL-MIOM Backend","database":"connected","timestamp":"..."}
```

**Database unreachable (HTTP 503):**

```json
{"status":"error","service":"SAIL-MIOM Backend","database":"disconnected","timestamp":"..."}
```

Backward compatibility:

- The response is **additive** — `status`, `service`, `timestamp` are unchanged;
  `database` is new. Anything matching `"status":"ok"` still works.
- **Behaviour change:** the endpoint returns **503** (was always 200) when the DB
  is down. Update any uptime monitor that treats only `200` as healthy — a 503
  here is a *correct* "DB down" alert, not a false alarm.

---

## CORS / ALLOWED_ORIGINS review

CORS origins come from the `ALLOWED_ORIGINS` env var (comma-separated), consumed
in `src/app.js`. With `credentials: true`, every browser origin that calls the
API cross-origin **must** be listed explicitly (no wildcard).

Before go-live, confirm the production origin is present:

```bash
# .env on EC2 — review this line:
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,https://sail-miom.ddns.net
```

- If the admin site is served from the **same** domain as the API (current Nginx
  setup), calls are same-origin and CORS is not triggered — but listing
  `https://sail-miom.ddns.net` is still recommended for any cross-origin tooling
  or future split hosting.
- Restart PM2 after changing `.env` (`pm2 restart sail-miom-backend`).

---

## Required env vars

Validated at boot by `src/config/validateEnv.js` — the process **exits** if a
required var is missing:

- **Required:** `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`
- **Recommended (warns):** `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `AWS_*`

`.env` is git-ignored and must never be committed. Keep a server-side backup
(`~/.env.sail-miom.bak`) before every `git pull`.
