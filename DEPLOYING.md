# Deploying (dev vs production)

Volt's cloud backend (console + gateway + marketing site) deploys with **SST**, one **stage** per environment.
Same code, same secret *names* — the stage decides the domain, the DB branch, and the secret *values*.

## The two flows

| | **dev** | **production** |
|---|---|---|
| Trigger | **Auto** — every push to `dev` that touches a deployed path (`packages/console/**`, `packages/volt-www/**`, `infra/**`, `sst.config.ts`, …) | **Manual** — `gh workflow run deploy.yml -f stage=production --ref dev`, then **approve** the run (required-reviewer gate on the `production` GitHub env) |
| Console | `dev.volt-ai.dev` | `volt-ai.dev` |
| Marketing site | `www.dev.volt-ai.dev` | `www.volt-ai.dev` |
| DB branch (PlanetScale `volt`) | branch **`dev`** (forked from `main`) | branch **`main`** |

Everything runs in CI on Linux — the console web build fails on Windows, so never `sst deploy` from your laptop.
Rule of thumb: **merge to `dev` = dev is live**; production is a deliberate, approved button-press off the same `dev` code.

## Env variables — do you manage two sets?

**No manual per-var work.** The stage-specific values are derived automatically in `infra/`:
- **Domain** (`infra/stage.ts`) → `volt-ai.dev` for production, `dev.volt-ai.dev` for dev.
- **DB branch + password** (`infra/console.ts`) → `main` for production, a `<stage>` branch for everything else.
- **Site's `VITE_CONSOLE_URL`** (`infra/www.ts`) → baked to the apex (`https://<domain>`) at build, so dev's site points at dev's console and prod's at prod's.

The only thing you maintain per stage is the **GitHub Environment secrets** (`Settings → Environments → dev` / `production`).
Same names in both; **values differ** where the resource is stage-specific:
- Point at prod resources: `PLANETSCALE_SERVICE_TOKEN*` (prod branch), `ZEN_SESSION_SECRET` (fresh per stage).
- Real vs test: `STRIPE_*` (test in dev, **live** in prod when you go real), OAuth apps must have the matching callback host.
- Reusable across stages: `CLOUDFLARE_API_TOKEN`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `UPSTASH*`, `ZEN_LIMITS`.
- **`HONEYCOMB_API_KEY`**: production-only *and* requires the Workers **Paid** plan (activates the tail-worker log pipeline). Leave it unset until you're on Paid, or the prod deploy fails.

`deploy.yml` loads these into SST **in the deploy job** (`deploy-secrets.ts`) — CI can't see secrets you set from a laptop, so the GitHub env is the source of truth.

## DB migrations (separate, not part of deploy)

Migrations run **out-of-band**, like opencode — not in `deploy.yml`. After deploying a stage:

```bash
bun run --cwd packages/console/core db-dev   migrate   # dev branch
bun run --cwd packages/console/core db-prod  migrate   # main branch (production)
```

Both resolve the DB connection from that stage's deployed SST state (`sst shell --stage <stage>`), so the stage
must be deployed first. `drizzle-kit migrate` is idempotent. Prod's `main` already carries a baseline (the `dev`
branch was forked from it) — only re-run when `main` lags dev's applied migrations.
