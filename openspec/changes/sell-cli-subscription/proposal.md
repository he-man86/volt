## Why

Two questions, asked a day apart, collapse most of Volt's commercial backend.

**First: should Volt sell AI gateway access?** No. `packages/console/app/src/routes/zen` is 4,283 lines — half of
all console routes — plus `model.ts`, `provider.ts`, a 599-line metered `billing.ts`, 30 `ZEN_MODELS` secret
chunks, every upstream provider API key, Upstash, three R2 buckets and a LogProcessor worker. Selling it means
fronting provider costs and hoping the markup holds; the cache-billing bug found in
`mirror-opencode-model-catalog` — cached tokens billing at **zero** while Anthropic charged for them — is that
risk materialising. Volt sells a PLC toolchain. A flat subscription for it has no COGS.

**Second: with a licensing partner, is a backend needed at all?** Also no. Everything a subscription business
needs — checkout, EU VAT, licence issuance, revocation on cancellation, a customer portal — is available from a
single merchant of record. What remains is a static marketing site and a licence check in a client that already
exists.

This change therefore deletes far more than it builds.

## What this change is

**Sell Volt as a €19/month subscription through [Polar](https://polar.sh), and delete `packages/console`
entirely.** No replacement console is built.

```
volt-www          static marketing site            →  Cloudflare
  ↓ buy
Polar checkout    payment + EU VAT + licence key issued
  ↓
connector         validates against Polar on a schedule, caches the verdict
Polar portal      customer manages key, devices, billing, invoices
```

Providers become **Cloudflare + Polar + GitHub**. Stripe drops out — Polar is the merchant of record.

## What is deliberately NOT built

This is the point of the change, so it is worth stating as plainly as the work:

- **No database.** No D1, no PlanetScale, no Prisma or Drizzle schemas. Polar holds customers and licences.
- **No auth system.** No OpenAuth issuer, no sign-in, no sessions. The licence key is the credential.
- **No dashboard.** Polar's customer portal covers key, devices, billing and invoices.
- **No console package.** No Next.js, no React Router, no SolidStart — the framework question dissolves with
  the app it was for. `volt-www` stays as it is: React + Vite, static.
- **No Stripe integration**, no webhook handler, no reconciliation path, no VAT registration or OSS filing.

## Why Polar, and what was rejected

Measured 2026-07-29.

| | fixed cost | subscription licences | offline | activations/licence | non-prod env |
|---|---|---|---|---|---|
| **Polar** | **$0** (5% + 50¢, +1.5% non-US cards) | ✅ | via client cache | configurable | n/a |
| LicenseSpring Free | $0 | ❌ **perpetual only** | ❌ greyed out | **1** | ❌ |
| LicenseSpring Starter | **$199/mo** | ✅ | ✅ | 10 | 3 |
| Cryptolens (Devolens) | ~€99/mo | ✅ | ✅ | — | — |
| Keygen | $199/mo | ✅ | ✅ | — | — |

**LicenseSpring's free tier cannot express the business model.** It supports Perpetual licences only — not
Subscription, and not even Time Limited, so it cannot be faked with 30-day renewals. Offline Licensing is
greyed out, activations are capped at 1 device, there is no non-production environment, and active licences cap
at 100. The tier that works is $199/month — roughly ten subscribers of revenue as a fixed cost, payable from
day one at zero subscribers.

Its SDK is genuinely good, and the offline activation-file / deactivation-file exchange is the right design for
air-gapped licensing. **Volt does not need it**: the enforcement model chosen here ("keep what you have, add
nothing new", §0.2) requires no activation files, no node-locking and no device-transfer protocol.

**Polar costs nothing until revenue exists**, because it is purely proportional. On €19 that is ≈ €1.70 per
charge (≈ 8.9%, including the +1.5% non-US card fee that applies to essentially every European customer). The
Pro plan at $20/month becomes cheaper above roughly 58 subscribers.

## What Polar provides

- **Licence keys** issued automatically on subscription, with a brandable prefix (`VOLT_*****`), optional
  expiry, and **automatic revocation when a subscription is cancelled**.
- **`/activate`** registers a device instance with labels, metadata and optional conditions; **`/validate`**
  checks a key per session. Activation limits are configurable, so multi-device is a setting rather than a
  build.
- **A customer portal** where the user copies their key, sees expiry, manages devices and handles billing.
- **Merchant of record** — *"we are liable as your reseller"*. Polar registers for VAT, calculates, collects,
  files and remits, and monitors thresholds to register in new markets. This deletes the EU VAT / OSS work
  entirely.

## What Volt still builds

Three things, all small:

1. A pricing/buy page on `volt-www`, linking to Polar checkout.
2. Licence validation in the **connector** — it is always-on, already phones home for updates, and already has
   a status window. It caches a verdict; the CLI reads the cache and makes no network call.
3. Enforcement of the free allowance in the CLI, counted against its own bindings.

## Risks

- **Polar is young** — launched 2023, and raised prices 25% in May 2026 (4% + 40¢ → 5% + 50¢). A pricing or
  viability shock lands directly on the business model. Mitigated by the licence check being ours: swapping
  provider means changing one endpoint and reissuing keys, not rebuilding.
- **Merchant of record means Polar owns the customer relationship.** Volt does not hold card details, and
  refunds and chargebacks run through them. That is the trade for them carrying tax liability.
- **Their licensing is simpler than a dedicated platform.** A competitor calls it "a checkbox feature". The
  parts it lacks — offline activation files, air-gapped portals — are ones this design does not use, but that
  ceases to be true if Volt ever sells into genuinely air-gapped sites.
- **Fees cross over.** At roughly 1,000 subscribers Polar costs perhaps €600/month more than Stripe plus a
  self-built licence service. That is the trigger to revisit, not a reason to pre-build.
- **No account means no funnel.** Without sign-in there is no mailing list and no usage signal beyond what
  Polar reports and what telemetry is added later. Accepted deliberately; see §0.5.

## Non-goals

- The AI gateway, in any form.
- Metered or usage-based billing.
- A Volt-built dashboard, login, or database. If one is ever needed, it is a separate change with its own
  justification — not something to leave a placeholder for.
- Team/seat management. Polar supports multi-seat subscriptions; wiring that up is future work.

## Supersedes

- `volt-console` (archived 2026-07-29) — proposed building `packages/volt-console` with auth, D1, Prisma and a
  dashboard. Its §0 decisions on tiers, enforcement, price and the connector survive and are carried into this
  change; its database, auth, workspace and framework decisions are moot because the package is not built.
