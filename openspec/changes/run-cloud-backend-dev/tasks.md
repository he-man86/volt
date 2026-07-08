## 1. Minimal code edits (fork-owned infra — see design.md "Minimal change set")

Identity (required):
- [ ] 1.1 `infra/stage.ts`: `domain` (lines 2-4) + `zoneID` (line 7) → our domain + Cloudflare zone id
- [ ] 1.2 `infra/console.ts`: PlanetScale `name`→`volt`, `organization`→our org (lines 12-13)
- [ ] 1.3 AWS profile: edit `sst.config.ts:17-18` → our profile name (or alias a local SSO profile `opencode-dev`)

The cut (recommended — makes the stage console+auth+billing only):
- [ ] 1.4 Move `EMAILOCTOPUS_API_KEY` from `infra/app.ts` → `infra/secret.ts`; re-import in `infra/console.ts:2`
- [ ] 1.5 `infra/stage.ts`: add `deployFull = $app.stage === "dev" || "production"`
- [ ] 1.6 `sst.config.ts` `run()`: gate the `app` + `enterprise` imports behind `stage.deployFull`

## 2. Accounts & secrets

- [ ] 2.1 AWS SSO profile logged in (`aws sso login`); confirm `sst` can assume it
- [ ] 2.2 Fix `GITHUB_CLIENT_SECRET_CONSOLE` in `.env` (currently = client id, wrong)
- [ ] 2.3 GitHub + Google OAuth apps: callback URL → `https://auth.volt.dev.<domain>`
- [ ] 2.4 Load secrets into SST: `bunx sst secret load .env --stage volt`
      (ignore the dead `DATABASE_*` keys — SST generates the real DB password)

## 3. Database

- [ ] 3.1 PlanetScale `volt`: ensure a `production` branch exists (the stage branch forks from it)
- [ ] 3.2 Migrate: `bun --cwd packages/console/core db push` (via `sst shell`)

## 4. Run & verify (console + auth + billing)

- [ ] 4.1 `bun sst dev --stage volt` — provisions auth worker, KV, Stripe webhook, console
- [ ] 4.2 Console renders at `volt.dev.<domain>`; sign in via GitHub/Google works
- [ ] 4.3 Stripe test checkout reaches `/stripe/webhook`; subscription row lands in DB
      (in dev, if the console runs locally, forward events: `stripe listen --forward-to localhost:3001/stripe/webhook`)
- [ ] 4.4 Confirm ZEN model-call path is absent (expected — not blocking Stage 1)

## 5. Commit hygiene (push-time, not deploy-time)

- [ ] 5.1 `volt-scripts/check-divergence.ts`: allowlist `infra/**` + `sst.config.ts` before `git push`
- [ ] 5.2 Rotate the CF token / PlanetScale password that sat in the scratch `.env`

## 6. Documented-not-built (later stages)

- [ ] 6.1 SES/EmailOctopus keys → real auth emails
- [ ] 6.2 AWS lake/stats/monitoring (stage `dev`/`production`) → `deploy-revenue-cloud`
- [ ] 6.3 ZEN gateway replacement (our own) → `deploy-revenue-cloud`
- [ ] 6.4 Frontend replacement → `commercial-landing`
