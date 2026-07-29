# infra — pristine opencode, and what to change

`infra/`, `sst.config.ts` and `.github/workflows/deploy.yml` are **opencode v1.18.3** (`sst/opencode`) with
two deliberate changes, listed under "Applied divergences" below. Everything else is byte-identical, and
this file is the only added file, so upstream merges stay clean.

Verify at any time:

```bash
git clone --filter=blob:none --no-checkout --depth 1 --branch v1.18.3 https://github.com/sst/opencode.git /tmp/oc
cd /tmp/oc && git sparse-checkout init --cone && git sparse-checkout set infra .github/workflows sst.config.ts && git checkout
diff <(tr -d '\r' < /tmp/oc/infra/console.ts) <path-to-volt>/infra/console.ts     # expect no output
```

> **As shipped, this does not deploy.** It points at `opencode.ai`, opencode's Cloudflare zone and the
> `anomalyco/opencode` PlanetScale database, and it builds `packages/function`, `packages/web` and
> `packages/app` — none of which exist in this repo. Apply groups **A–D** before any deploy.

Line numbers below are against the files **as they are now** (upstream plus the applied divergences), and
shift as you edit — so work **bottom-up within a file**.

---

## Applied divergences

### Salesforce removed (`infra/console.ts`)

`SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET` and `SALESFORCE_INSTANCE_URL` — the three `new sst.Secret(…)`
declarations and their three entries in the `Console` link list — are deleted, replaced by a `VOLT:` comment.

**Why:** their only consumer was `app/src/routes/api/enterprise.ts` (through `app/src/lib/salesforce.ts`), and
both files were deleted by the public-surface strip. Nothing in Volt's console reads them, so upstream they
were three secrets that had to be *set* for `sst deploy` to succeed while doing nothing.

What the integration was, for the record: an 81-line, write-only pipe. The enterprise contact form fired one
`POST /services/data/v59.0/sobjects/Lead` per submission (`LastName` = the whole name, `Company` defaulting to
the literal `"Website"`), alongside an SES mail to `contact@anoma.ly` and an EmailOctopus subscribe, in a single
`Promise.all` where any one failing is ignored. It was never a customer database — paying customers live in
PlanetScale and Stripe, and nothing bridges them to Salesforce.

**To restore:** re-add the three secrets and their link entries, then bring back `lib/salesforce.ts` and
`routes/api/enterprise.ts` from upstream. An enterprise contact form works with just the SES mail; the
Salesforce half only pays off once a sales pipeline actually runs in it.

### Authoring stage renamed `frank` → `marce`

`packages/console/core/script/update-models.ts` (2 lines) and `promote-models.ts` (1 line), each with a
`VOLT:` marker.

**What `frank` is:** a person. opencode hardcodes several developers' personal SST stages into their infra —
`vimtor` and `adam` (`infra/app.ts:33`), `thdxr` (`:44`), and `frank` in the model scripts. `sst deploy` with
no `--stage` targets *your own* stage, so each developer gets an isolated copy; `production` and `dev` are the
only shared ones.

**Why that matters:** the model catalog's master copy — including every upstream provider API key — lives in
one named individual's personal stage, and dev/prod are *promoted* from it. So the scripts form a small release
pipeline:

```
bun run pull-models-from-prod    # prod's catalog  → your stage
bun run update-models            # your stage → $EDITOR → validate → back to your stage
bun run promote-models-to-dev    # your stage → dev
bun run promote-models-to-prod   # your stage → production
```

Run them from `packages/console/core`. `update-models` opens **vim**, which is hardcoded — that needs no edit
here because Git for Windows ships vim at `/usr/bin/vim`.

Volt's authoring stage is **`marce`**, set in `.sst/stage` (gitignored, so not a repo change). Change it in
three places if you rename: `.sst/stage`, and the two scripts above.

> ⚠️ `sst remove` on the authoring stage deletes the state, the secrets **and the encryption passphrase**. That
> would destroy the master catalog. Prod keeps its own copy, so recovery means `pull-models-from-prod` — but
> anything edited and not yet promoted is gone.

**Left as `frank` on purpose:** `script/reset-db.ts:9` guards on `Resource.App.stage !== "frank"`. Pointing at
a stage that does not exist makes that destructive script inert, which is the safer default. Change it only if
you actually want to be able to reset the database.

### Related, deliberately NOT removed

- **`AWS_SES_*` — keep.** Not only for the enterprise form: `core/src/user.ts:143` sends workspace **invite
  emails** through SES. That is a live feature.
- **`EMAILOCTOPUS_API_KEY` — keep declared.** Dead in Volt today, but only because the strip removed its two
  consumers: the general newsletter box (`component/email-signup.tsx`, rendered on `routes/index.tsx`,
  `go/index.tsx` and `zen/index.tsx`) and the enterprise form. It is a real marketing list — two lists actually
  — and `email-signup.tsx` is 45 lines, directly reusable if `volt-www` ever wants a signup box. Note it is
  opt-in only: nothing subscribes a user on registration or checkout.

---

## Order of work

The groups are ordered so each one is independently checkable. Apply and commit **one at a time** — a single
commit per group keeps the diff against upstream readable, and makes any group revertible on its own.

| # | group | verify with |
|---|---|---|
| 1 | **C** — ✅ files deleted + unhooked; ⬜ still gut `app.ts` and drop its import | `bun run typecheck` — no unresolved imports |
| 2 | **B** — drop the `aws` provider, conditional Honeycomb | `bunx sst secret list --stage <s>` runs at all |
| 3 | **A** — domain, zone, app name, PlanetScale | grep for `opencode.ai` / `anomalyco` → no hits |
| 4 | **D** — restore `www.ts` + `support.ts`, add two `export`s | `sst.config.ts` imports resolve |
| 5 | **G** — `deploy.yml` (line 18 **first**, see the warning there) | a `workflow_dispatch` run actually starts |
| 6 | **E** — tail-consumer gate, `CONSOLE_DEV_EMAILS` | only matters on a real deploy |
| 7 | **F** — pricing | deliberately last; changes live Stripe products |

C before B before A is deliberate: C removes the files that *use* the `aws` provider, so B is then a clean
deletion; and A is pure find-and-replace once nothing structural is still moving.

> ⚠️ **Until group B lands, no `sst` command works at all** — not just deploys. SST initialises every declared
> provider up front, and opencode's `aws` block points at `opencode-dev` / `opencode-production` SSO profiles
> that do not exist here, so even `sst secret list` fails with
> `aws: failed to refresh cached credentials … InvalidGrantException`. That includes seeding the model catalog
> into your authoring stage. B is a 9-line deletion; do it early.

Do not deploy until the secrets exist — `sst deploy` errors on the first unset one, and secrets are now set
out of band (see group G).

---

## A. Identity — domain, zone, app name (REQUIRED)

### `infra/stage.ts`

| line | from | to |
|---|---|---|
| 2 | `return "opencode.ai"` | `return "volt-ai.dev"` |
| 3 | `return "dev.opencode.ai"` | `return "dev.volt-ai.dev"` |
| 4 | `` return `${$app.stage}.dev.opencode.ai` `` | `` return `${$app.stage}.dev.volt-ai.dev` `` |
| 7 | `zoneID = "430ba34c138cfb5360826c4909f99be8"` | `zoneID = "ebac4f049c913d03ae11f89114379d6c"` |
| **11–15** | `new cloudflare.RegionalHostname({...})` | **delete** — Cloudflare Data Localization Suite is a paid add-on and needs a "Regional Services" token permission |
| **17–21** | `export const shortDomain = …` | **delete** — its only consumer was `enterprise.ts`, already deleted, so it is dead now |

### `sst.config.ts`

| line | from | to |
|---|---|---|
| 6 | `name: "opencode"` | `name: "volt"` |

### `infra/console.ts` — PlanetScale account

| line | from | to |
|---|---|---|
| 10 | `name: "opencode"` | `name: "volt"` |
| 11 | `organization: "anomalyco"` | `organization: "mheijmans"` |
| 17 | `name: "production"` | `name: "main"` |
| 25 | `parentBranch: "production"` | `parentBranch: "main"` |

Lines 19 and 27 exist because Volt's database uses PlanetScale's default `main` branch as production; opencode
created a branch literally named `production`.

---

## B. Providers — drop AWS (REQUIRED — blocks every `sst` command)

Not a deploy-time concern: SST initialises declared providers before doing anything, so with the `aws` block
present even `sst secret list` fails. Nothing here can be set or read until this is deleted.

### `sst.config.ts`

| line | change |
|---|---|
| **11–19** | **delete the whole `aws: { … }` provider block.** It sets `opencode-dev` / `opencode-production` profiles. The infra already creates zero AWS resources — SES email goes over HTTP with `AWS_SES_*` keys, not the Pulumi provider |
| 26 | `honeycomb: "0.49.0",` → `...(process.env.HONEYCOMB_API_KEY ? { honeycomb: "0.49.0" } : {}),` so a deploy without a Honeycomb account still works |
| 48 | `AwsStage: stage.awsStage,` — drop from the returned outputs |

And in **`infra/stage.ts`** delete lines 8–9, `awsStage` / `deployAws`. Group C removed their last real
consumer; only the `AwsStage` output above still reads one.

---

## C. Remove what Volt doesn't vendor (REQUIRED — otherwise the build fails)

### ✅ Already applied — `lake.ts`, `stats.ts`, `enterprise.ts` deleted

| file | why |
|---|---|
| `infra/lake.ts` | needs the `aws` provider |
| `infra/stats.ts` | needs the `aws` provider (and deploys `packages/stats`, not vendored) |
| `infra/enterprise.ts` | uses `shortDomain`; an opencode-only product |

Deleting them required three companion edits, also applied — a file deletion alone would have left dangling
imports:

**`sst.config.ts`** — dropped `const lake = …` / `const stats = …` / `await import("./infra/enterprise.js")`,
and the `StatsUrl` / `LakeUrl` / `LakeSecretSsm` entries from the returned outputs.

**`infra/console.ts`** — the lake was reached from here too:

| was | now |
|---|---|
| `import { deployAws, domain } from "./stage"` | `import { domain } from "./stage"` |
| `const lake = deployAws ? await import("./lake") : undefined` | *(deleted)* |
| `link: [SECRET.HoneycombApiKey, ...(lake?.lakeIngest ? [lake.lakeIngest] : [])],` | `link: [SECRET.HoneycombApiKey],` |

`stage.ts` still exports `awsStage` and `deployAws` — `sst.config.ts` returns `AwsStage`, and `deployAws` now
has no consumer. Both can go with group B.

### ⬜ Still to do — `infra/app.ts`: replace the whole file with one line

```ts
export const EMAILOCTOPUS_API_KEY = new sst.Secret("EMAILOCTOPUS_API_KEY")
```

Upstream's version deploys the `Api` Worker (`packages/function`), the `Web` Astro docs site (`packages/web`)
and the `WebApp` static site (`packages/app`). None are vendored here. That secret is the only thing the rest
of the infra imports from it.

### ⬜ Still to do — `sst.config.ts`

| change |
|---|
| delete `await import("./infra/app.js")` — nothing left to deploy from it once `app.ts` is gutted |
| replace the `$app.stage === "production" \|\| "vimtor"` monitoring gate with `if (process.env.HONEYCOMB_ALERTS === "on") await import("./infra/monitoring.js")` |

---

## D. Volt-only infra (REQUIRED for the landing page + support portal)

Both files are recoverable verbatim from the last commit that still had them:

```bash
git log --oneline -1 -- infra/www.ts          # find that commit if HEAD has moved past it
git show <commit>:infra/www.ts     > infra/www.ts
git show <commit>:infra/support.ts > infra/support.ts
```

(While the reset is uncommitted, plain `git show HEAD:infra/www.ts` works.)

Then add to `sst.config.ts`'s `run()`:

```ts
await import("./infra/www.js")      // packages/volt-www at www.${domain}
await import("./infra/support.js")  // the support portal at support.${domain}
```

`support.ts` imports `database`, `ZEN_LITE_PRICE` and `ZEN_BLACK_PRICE` from `console.ts`, so add `export` to:

| `infra/console.ts` line | change |
|---|---|
| 149 | `const ZEN_LITE_PRICE` → `export const ZEN_LITE_PRICE` |
| 176 | `const ZEN_BLACK_PRICE` → `export const ZEN_BLACK_PRICE` |

`database` (line 34) is already exported upstream.

`support.ts` also carries one Volt value: `process.env.SUPPORT_ALLOWED_EMAILS ?? "mheijmans@gmail.com"`.

---

## E. Hosting-plan workarounds (apply if still on these plans)

### `infra/console.ts`

| line | change |
|---|---|
| 286 | `tailConsumers: [{ service: logProcessor.nodes.worker.scriptName }],` → `tailConsumers: process.env.HONEYCOMB_API_KEY ? [{ service: logProcessor.nodes.worker.scriptName }] : [],` |

Tail Workers require the Cloudflare Workers **Paid** plan. Unconditional, it fails the deploy on Free.

### `CONSOLE_DEV_EMAILS` — the dev-login allow-list

Read by `packages/console/function/src/auth.ts` and `app/src/routes/workspace/[id]/go/lite-section.tsx`, both
of which Volt modified — without it, those break.

```ts
// infra/secret.ts — inside SECRET
ConsoleDevEmails: new sst.Secret("CONSOLE_DEV_EMAILS"),

// infra/console.ts line 65 — the auth worker, after `link: [...]`
environment: { CONSOLE_DEV_EMAILS: process.env.CONSOLE_DEV_EMAILS ?? "" },

// infra/console.ts line 265 — the console's link list, next to ZEN_LIMITS
SECRET.ConsoleDevEmails,
```

---

## F. Pricing (deliberate — not applied yet)

The base is opencode's: **USD, $10/mo, "OpenCode Go"**, plus a `ZenLiteCouponFirstMonth50` resource.

| `infra/console.ts` line | upstream | Volt was |
|---|---|---|
| 105 | `name: "OpenCode Go"` | `name: "Volt Gateway"` |
| 142 | `currency: "usd"` | `currency: "eur"` |
| 147 | `unitAmount: 1000` | `unitAmount: 2400` (€24) |
| 107–112 | `zenLiteCouponFirstMonth50` created, linked at 154 | resource deleted; `firstMonth50Coupon` set to a dead sentinel string |

⚠️ The coupon resource exists again, but it is **not auto-applied** — the `VOLT:`-marked edit in
`packages/console/core/src/billing.ts` still removes opencode's default. **Keep that edit.** Without it every
new subscriber silently gets 50% off their first month.

"OpenCode Black" (line 163) is intentionally left unbranded — Volt only sells the Gateway plan, so it is never
shown.

---

## G. `.github/workflows/deploy.yml`

Also pristine upstream.

> ⚠️ **As shipped this workflow is inert — it does not fail, it silently skips.** Line 18 guards the job on
> `github.repository == 'anomalyco/opencode'`, which is never true here, so every run reports success having
> deployed nothing. Nothing else in CI notices. Fix line 18 first; until then no other change in this section
> has any observable effect.
>
> Line 24 is the second landmine: `uses: ./.github/actions/setup-bun` is a composite action that only exists
> in opencode's repo. Once line 18 is fixed, the job starts failing there instead of skipping — which is an
> improvement, but expect it.

Volt needs:

| line | change |
|---|---|
| **18** | `if: github.repository == 'anomalyco/opencode' && …` — **retarget or delete, first.** Until then the job always skips |
| **24** | `uses: ./.github/actions/setup-bun` — that composite action doesn't exist here; use `oven-sh/setup-bun@v2` with `bun-version: 1.3.14` |
| **30–33** | delete the `aws-actions/configure-aws-credentials` step (no `aws` provider after group B) |
| 39 | `PLANETSCALE_SERVICE_TOKEN_NAME` → `PLANETSCALE_SERVICE_TOKEN_ID` (current name per the Pulumi provider) |
| **43–48** | delete every `SENTRY_*` / `VITE_SENTRY_*` — Sentry is dropped |
| 40 | `STRIPE_SECRET_KEY` picks `_PROD`/`_DEV` by branch; Volt uses one GitHub environment per stage, so a plain `${{ secrets.STRIPE_SECRET_KEY }}` works |

Add, because Volt's infra reads them at deploy time:

```yaml
HONEYCOMB_API_KEY: ${{ secrets.HONEYCOMB_CONFIG_KEY }}   # the CONFIG key, not the ingest key
CONSOLE_DEV_EMAILS: ${{ secrets.CONSOLE_DEV_EMAILS }}
SUPPORT_ALLOWED_EMAILS: ${{ secrets.SUPPORT_ALLOWED_EMAILS }}
HONEYCOMB_ALERTS: ${{ vars.HONEYCOMB_ALERTS }}
```

Also add a `paths:` filter and a `workflow_dispatch` stage input if you want manual production deploys —
upstream keys off `github.ref_name` with a `production` branch, which Volt does not have.

**Secrets are set out of band**, like opencode — the workflow env carries only provider credentials. Every
`sst.Secret` the app reads at runtime:

```bash
bunx sst secret set NAME <value> --stage <stage>
bunx sst secret load <file> --stage <stage>      # dotenv format
```

**As it stands the base declares 22 named secrets** plus `ZEN_MODELS1..30`, and `sst deploy` errors on the
first unset one. That count is inflated by the upstream files group C deletes — `app.ts` alone brings seven
that Volt has no use for (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `ADMIN_SECRET`, `DISCORD_SUPPORT_BOT_TOKEN`,
`DISCORD_SUPPORT_CHANNEL_ID`, `FEISHU_APP_ID`, `FEISHU_APP_SECRET`). After group C it settles at **16 named**:

| file | secrets |
|---|---|
| `app.ts` (gutted) | `EMAILOCTOPUS_API_KEY` |
| `console.ts` | `GITHUB_CLIENT_ID_CONSOLE`, `GITHUB_CLIENT_SECRET_CONSOLE`, `GOOGLE_CLIENT_ID`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `DISCORD_INCIDENT_WEBHOOK_URL`, `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY`, `ZEN_LIMITS`, `ZEN_SESSION_SECRET` |
| `secret.ts` | `HONEYCOMB_API_KEY`, `SUPPORT_API_KEY`, `UpstashRedisRestUrl`, `UpstashRedisRestToken` (+ `CONSOLE_DEV_EMAILS` from group E) |

`ZEN_MODELS1..30` is the gateway model catalog, edited with
`packages/console/core/script/update-models.ts` — note it hardcodes `--stage frank` and `vim`.
