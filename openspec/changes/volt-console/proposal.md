## Why

Volt's commercial backend is a vendored fork of opencode's console, and **most of it exists to run an LLM
gateway Volt is no longer going to sell**. Measured 2026-07-29:

| | |
|---|---|
| `packages/console/app/src/routes/zen` | **4,283 lines** — the gateway, half of all console routes (8,568) |
| supporting it in `core/src` | `model.ts`, `provider.ts`, metered `billing.ts` (599 lines), `lite.ts`, `black.ts` |
| operational surface | 30 `ZEN_MODELS` secret chunks, every upstream provider API key, `ZEN_LIMITS`, Upstash Redis, 3 R2 buckets, a LogProcessor worker |

Selling gateway access also means **fronting provider costs and hoping the markup covers them**. The
cache-billing bug found in `mirror-opencode-model-catalog` — cached tokens billing at **zero** while Anthropic
charged for them — is that risk materialising, and it survived precisely because the catalog is an encrypted
blob edited in vim with no diff and no review.

Volt sells a PLC toolchain. A flat subscription for that has no COGS, no provider keys, no metering, and no
catalog. The gateway is the single largest source of complexity and cost in the product, and it is optional.

Separately, the vendored console is hard to work in. Its rules exist to keep upstream merges cheap — but
**without the gateway there is no reason to track opencode's console again**, so that constraint stops paying
for itself while the mess remains.

## What this change is

Build **`packages/volt-console`** — a new, Volt-owned package — and delete `packages/console`.

It is the product dashboard: sign in, see your workspace, manage a subscription, get a licence key. Tiers are
**free / pro**, with **team** designed for but not built.

Keep what already works: SST-driven deploys (everything as code, nothing clicked in a dashboard), the
`dev` / `production` stage split, and the support portal.

## What we keep from opencode's design

Its data model already supports free/pro/team, and is worth copying rather than inventing:

```
Account   (login identity)  →  auth.sql.ts, account.sql.ts
Workspace (the org)         →  workspace.sql.ts        ← the "team" primitive, already there
User      (membership)      →  user.sql.ts             ← User.invite + joinInvitedWorkspaces exist
Billing   (Stripe linkage)  →  billing.sql.ts
Key       (per-workspace)   →  key.sql.ts              ← becomes the licence key
```

`subscription.ts` already models three tiers (`free` / `lite` / `black`). `lite` → **pro**; `black` → **team**
or dropped.

**Copy the shape, not the code.** These are 6 of 11 tables and a few hundred lines of clean domain logic; the
rest (`benchmark`, `ip`, `model`, `provider`, `referral`) is gateway or opencode-specific.

## What gets deleted

- `packages/console` entirely — including the vendored-console rule, `DIVERGENCE`-style discipline, and the
  merge burden.
- The gateway: all of `routes/zen`, provider routing, rate limiters, budget/TPM/TPS trackers.
- The model catalog: `ZEN_MODELS1..30`, `update-models` / `promote-models` / `pull-models`, the personal
  authoring stage, provider API keys.
- Client-side coupling — exactly two files: the `provider.volt` block in `opencode-config/opencode.json` and
  `opencode-config/plugins/volt-auth.ts`. Nothing in `volt-cli`, `volt-control`, `volt-desktop` or the LSP
  touches the gateway.
- Infra that only served it: Upstash Redis, `ZenData` / `ZenDataNew` / `Bucket` R2 buckets, the LogProcessor
  worker, and `ZEN_LIMITS`.

`opencode-config` stays — the LSP, the `volt` tool and the permission gates are what make opencode PLC-aware,
and they are unaffected. Users bring their own opencode and their own model provider key.

## The one genuinely new thing

**There is no licence or entitlement check anywhere in Volt today** — metered gateway usage *was* the
enforcement. A flat subscription needs a key the CLI holds, an endpoint to validate it, and an offline grace
policy so a customer on a plant floor with no internet is not locked out of their toolchain.

That is the only net-new system here. Everything else is deletion.

## Open questions — decide before building

**Tiers**
- What does **free** actually include? Is it the full toolchain with nagging, a feature-limited build, or
  time-limited? This decides whether free needs an account at all.
- What does **pro** unlock? Until there is a concrete list, the licence check has nothing to gate.
- Does free require sign-in, or is it fully offline? Offline free is simpler and friendlier, but gives no
  funnel and no usage signal.

**Enforcement**
- Hard gate (refuse to run) or soft (warn, degrade)? For a tool engineers depend on mid-shift, a hard gate on a
  failed network call is hostile.
- Offline grace period — days? weeks? What happens when it expires with no connectivity?
- Per-machine binding, or is a shared key acceptable? Binding means device management; not binding means the
  key spreads.

**Shape**
- Keep PlanetScale, or move to Cloudflare D1? D1 is SST-provisionable and free-tier; PlanetScale has no free
  tier and is sized for the gateway's load, which is gone.
- Are workspaces present from day one (so team is a tier flip), or added later (simpler now, migration later)?
- Reuse the deployed OpenAuth issuer, or something simpler? It works today and is already provisioned.
- Does the support portal move into `volt-console`, or stay its own worker?

**Commercial**
- Price, currency, trial. `stripe-go-live` carries the current thinking for the gateway product; it needs
  redoing for a flat CLI subscription.

## Risks

- **Walking away from working, deployed code.** Auth, Stripe, the webhook and the console are live on
  `volt-ai.dev`. This is a real cost, not zero — the argument for paying it is that code nobody can maintain
  is not an asset.
- **Licence enforcement is new and untested**, and it sits in the path of every paying customer. Getting the
  offline story wrong turns a network blip into a support incident.
- **Stripe webhook reliability becomes load-bearing** — if `checkout.session.completed` is missed, a paying
  customer has no key. Needs a reconciliation path, not just a webhook.
- Existing subscribers, if any, need migrating. Confirm the count before assuming it is zero.

## Non-goals

- The AI gateway, in any form. Explicitly out; this change exists to remove it.
- Metered or usage-based billing.
- Team/seat management as built functionality — designed for, not implemented.
- Changing the deploy model. SST + GitHub Actions stays: everything as code, nothing clicked.

## Follow-ups — spec separately, do not block this change

### Product telemetry (LSP + the `volt` tool)

Wanted: see how Volt behaves on **real** PLC projects, to hunt LSP bugs and false positives against the
projects Volt does not have in its corpus. The corpus tells you about four projects you own; telemetry tells
you about every project you do not.

Not to be confused with what Honeycomb does today. `infra/monitoring.ts` is an **error-rate SLO on the
gateway's HTTP responses** — it filters on `event_type = "completions"` and `user_agent contains "opencode"`
and alerts Discord when the failure ratio climbs. It never sees the LSP, and it dies with the gateway.

Signals worth collecting:

- **LSP** — which diagnostic codes fire, counts, timings, crash stacks, file kinds.
- **The `volt` tool** (`opencode-config/tool/volt.ts`) — Volt's own code, running inside the agent loop. Which
  verbs the agent reaches for, pull vs push ratios, what fails. Reveals how the agent uses Volt without seeing
  a single prompt.
- **Compile outcomes** — whether agent-written ST actually builds, via the bridge.

Constraints, non-negotiable:

- **Never ship source, identifiers or file paths.** PLC source is customer IP, frequently under NDA, in plants
  with strict IT policy. Diagnostic *codes* and counts only.
- **Opt-in and clearly disclosed.** Getting this wrong once ends the product's credibility with exactly the
  customers Volt wants.
- Collection belongs in `packages/volt-lsp-iec`, **not** `opencode-config` — the LSP also runs under the VS
  Code extension, which is probably where most users are. `opencode-config` can only *switch it on*: opencode's
  LSP config schema supports an `env` map (`lsp.volt-lsp-iec.env`), verified against `opencode.ai/config.json`.
- Destination under the fewest-providers rule (design.md 0.0): **Cloudflare Workers Analytics Engine** — built
  for high-cardinality custom metrics, SQL-queryable, no new vendor.

### Chat history analysis — attractive, but the gateway was the only clean route

Analysing conversations would show what engineers actually ask for and where the agent fails on PLC tasks.
**This change removes the only legitimate access to it.** Post-pivot the user's opencode talks directly to
their own provider; Volt is never in the path. That is the trade, not an oversight — no gateway, no COGS, no
data.

Recovering it would mean collecting conversations client-side, which is **categorically worse than the
telemetry above**: an AI coding agent's prompts contain the customer's PLC source verbatim. Recommended
against for this audience. The three signals above answer "is the agent useful for PLC work?" without holding
anyone's source.

## Supersedes

- `mirror-opencode-model-catalog` — the picker/catalog integration only matters with a gateway.
- `restore-out-of-band-secrets` — most of the secrets it is about disappear with the gateway. Its *finding*
  (CI cannot read secrets set from a dev machine) still applies to whatever remains.
- `stripe-go-live` — needs rewriting for a flat subscription rather than metered gateway billing.
- `console-production-launch` — describes launching the gateway console.
