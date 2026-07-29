# Design — what actually diverged from opencode

Measured **2026-07-29** against a sparse clone of `sst/opencode` at **v1.18.3** (the tag `packages/console` is
vendored from), comparing `infra/`, `sst.config.ts` and `.github/workflows/deploy.yml`.

```bash
git clone --filter=blob:none --no-checkout --depth 1 --branch v1.18.3 https://github.com/sst/opencode.git oc
cd oc && git sparse-checkout init --cone && git sparse-checkout set infra .github/workflows sst.config.ts && git checkout
```

## 1. The headline: `infra/` is fine. `deploy.yml` is the drift.

| file | opencode | Volt | differing lines |
|---|---|---|---|
| `infra/monitoring.ts` | 287 | 287 | **0 — byte-identical** |
| `infra/secret.ts` | 15 | 27 | 12 |
| `infra/stage.ts` | 21 | 15 | 24 |
| `infra/console.ts` | 307 | 325 | 78 |
| `infra/app.ts` | 69 | 8 | 75 |
| **`.github/workflows/deploy.yml`** | **48** | **188** | **192** |

opencode-only: `enterprise.ts`, `lake.ts`, `stats.ts` (deleted — opencode-specific products).
Volt-only: `www.ts` (the landing page), `support.ts` (the vendored support portal).

The `infra/` differences are **branding and feature-removal, not drift**:

- `stage.ts` — `volt-ai.dev` instead of `opencode.ai`, Volt's Cloudflare zone ID, and a dropped
  `RegionalHostname` (Cloudflare's paid Data Localization Suite, which also demanded a token permission most
  accounts lack).
- `secret.ts` — adds `ZEN_LIMITS` and `CONSOLE_DEV_EMAILS`, both real Volt features.
- `app.ts` — gutted to 8 lines because the dropped products took their infra with them.

**Conclusion: this change should not touch `infra/`.** The revert target is `deploy.yml` plus the
`volt-scripts/` that exist to feed it.

## 2. What opencode's deploy actually does

Forty-eight lines, one deploy step, and its `env:` block carries **only provider credentials** — the things SST
needs to *create resources*, never the app's own secrets:

```yaml
- run: bun sst deploy --stage=${{ github.ref_name }}
  env:
    CLOUDFLARE_API_TOKEN: …
    PLANETSCALE_SERVICE_TOKEN_NAME: …
    PLANETSCALE_SERVICE_TOKEN: …
    STRIPE_SECRET_KEY: …
    HONEYCOMB_API_KEY: …
    SENTRY_* / VITE_SENTRY_*: …
```

There is no secret-provisioning step. Every `sst.Secret` is set out of band and read from state at deploy.

That is the distinction Volt lost, and it is the whole change:

| class | how it is provided | count for Volt |
|---|---|---|
| **Deploy-time provider credentials** | `env:` in the workflow, from GitHub secrets | 5 |
| **App secrets** (`sst.Secret`) | `sst secret set` / `sst secret load`, once, out of band | 19 + 30 chunks |

`STRIPE_SECRET_KEY` and `HONEYCOMB_API_KEY` appear in **both** classes — a provider credential at deploy time
and an app secret at runtime. For Honeycomb they are even different keys (config vs ingest), which
`infra/secret.ts` already documents.

## 3. The mechanism objection is dead

`deploy-secrets.ts` and `deploy.yml` both justify the in-job provisioning with *"SST state is per-machine …
secrets set from a dev laptop are NOT visible to a fresh CI runner (proven: CI saw 0/48)"*.

**opencode's `sst.config.ts` sets `home: "cloudflare"` — the identical state backend Volt uses** — and their CI
reads out-of-band secrets successfully on every deploy. The backend is not the obstacle, and SST's own platform
source says the passphrase lives *in* that backend (`config.ts:322`).

So the 0/48 observation was almost certainly a **configuration** problem — most likely CI's
`CLOUDFLARE_API_TOKEN` resolving to a different account or lacking the scope to read the state — not a property
of SST. Task 1.2 is now the prime suspect rather than one of three equals.

One residual difference worth noting: opencode's deploy assumes an AWS role
(`aws-actions/configure-aws-credentials`) and declares an `aws` provider; Volt removed the AWS provider
deliberately (`sst.config.ts`: "the vendored infra creates zero AWS resources"). That affects resource creation,
not secret storage, so it does not explain the divergence.

## 4. Every app secret Volt declares

Nineteen named secrets plus the 30 catalog chunks. "in GH" is the `dev` environment as of 2026-07-29.

| secret | in `.env` | in GH `dev` | declared in |
|---|---|---|---|
| `AWS_SES_ACCESS_KEY_ID` | – | – | console.ts |
| `AWS_SES_SECRET_ACCESS_KEY` | – | – | console.ts |
| `CONSOLE_DEV_EMAILS` | – | yes | secret.ts |
| `DISCORD_INCIDENT_WEBHOOK_URL` | yes | yes | console.ts |
| `EMAILOCTOPUS_API_KEY` | yes | – | app.ts |
| `GITHUB_CLIENT_ID_CONSOLE` | yes | as `GH_CLIENT_ID_CONSOLE` | console.ts |
| `GITHUB_CLIENT_SECRET_CONSOLE` | yes | as `GH_CLIENT_SECRET_CONSOLE` | console.ts |
| `GOOGLE_CLIENT_ID` | yes | yes | console.ts |
| `HONEYCOMB_API_KEY` | yes | yes | secret.ts |
| `SALESFORCE_CLIENT_ID` | – | – | console.ts |
| `SALESFORCE_CLIENT_SECRET` | – | – | console.ts |
| `SALESFORCE_INSTANCE_URL` | – | – | console.ts |
| `STRIPE_PUBLISHABLE_KEY` | yes | yes | console.ts |
| `STRIPE_SECRET_KEY` | yes | yes | console.ts |
| `SUPPORT_API_KEY` | yes | yes | secret.ts |
| `UpstashRedisRestToken` | yes | yes | secret.ts |
| `UpstashRedisRestUrl` | yes | yes | secret.ts |
| `ZEN_LIMITS` | yes | yes | secret.ts |
| `ZEN_SESSION_SECRET` | yes | yes | console.ts |
| `ZEN_MODELS1..30` | 30/30 | – | console.ts |

Notes:

- `GITHUB_*` are stored in GitHub as `GH_*` — Actions reserves the `GITHUB_` secret-name prefix. Under the
  out-of-band model this mapping disappears with the workflow env block.
- The 6 unset ones (SES ×2, Salesforce ×3, EmailOctopus) are declared but unprovisioned; their features are
  inert. Out of band they must be set to *something* or `sst deploy` errors on an unset secret — this is the
  one job `PLACEHOLDER_UNSET` was doing that still needs an answer (task 4.4).
- `GOOGLE_CLIENT_SECRET` is passed by `deploy.yml` but is **not** declared anywhere in `infra/`. It is a stray
  and should be dropped with the env block.

## 5. Scope

Revert to opencode's shape:

- `.github/workflows/deploy.yml` → their 48-line form, minus the AWS step and Sentry (Volt has neither), plus
  Volt's path filter and stage input. Expect ~35 lines.
- Delete `volt-scripts/deploy-secrets.ts` and `volt-scripts/update-models.ts`.
- Use `packages/console/core/script/update-models.ts` with two `VOLT:`-marked value-edits.

Do **not** touch `infra/` — §1 shows it is already where it should be.
