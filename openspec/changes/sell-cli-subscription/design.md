# Design — decisions

Decisions taken 2026-07-29. §§0.1, 0.2, 0.2b, 0.7 and 0.8 are carried forward from `volt-console` (archived);
the rest are new or were dissolved by choosing Polar.

## 0.0 Providers — Cloudflare + Polar + GitHub

The rule set earlier was **fewest providers: prefer an extra Cloudflare product over an extra platform**, on
the grounds that operational surface — an account, a bill, a dashboard, credentials, an outage page — costs
more than unit price at Volt's scale.

Polar adds a platform, but it *removes* Stripe and prevents three others, so the count does not rise:

| need | provider |
|---|---|
| marketing site, DNS, (later) telemetry | **Cloudflare** |
| payment, EU VAT, licence keys, customer portal | **Polar** |
| source + Actions | **GitHub** |

Not needed, and therefore not adopted: Stripe (Polar is merchant of record), PlanetScale or D1 (no database),
AWS SES (no transactional email of Volt's own), Honeycomb (dies with the gateway), Upstash (same),
LicenseSpring / Cryptolens / Keygen (Polar covers it).

## 0.1 Tiers — free is 3 projects, pro is unlimited

| | free | pro |
|---|---|---|
| bound projects | **3** | unlimited |
| capability on a bound project | full — `pull`/`push`/`merge`, LSP, extension | full |

A project is a git repo root carrying `.git/volt/config.json` — one CODESYS or TwinCAT project, in practice one
machine or line.

Chosen over a 30-day trial because a count is a fact the client already knows, so **tier enforcement needs no
clock**; because it does not punish slow evaluation; and because it is a permanent funnel rather than one-shot
urgency. Risk accepted: an engineer with one or two machines never pays. 3 is low enough that most
professionals cross it.

**The count is enforced client-side** against the CLI's own bindings. Polar's activation limits are per
*device*, not per *project*, so they cannot express this — the allowance is Volt's to enforce. Gameable by
deleting `.git/volt` and re-running `init`; that is deliberate effort to dodge €19.

## 0.2 Enforcement — 14-day offline grace, then "keep what you have, add nothing new"

```
online              → validate against Polar, cache {tier, maxProjects, validatedAt}
offline < 14 days   → work normally
offline ≥ 14 days   → existing bound projects keep working; binding a NEW one is blocked,
                      with an explicit message
```

Never refuses to start. Never silently downgrades. Volt runs on plant floors where the network is unreliable or
absent, and a failed HTTP call must not cost an engineer their shift.

Past grace an engineer keeps working on every machine they already have, and only meets a wall starting
something new — which is exactly when reconnecting is reasonable. There is no separate degraded mode to design:
it is the free allowance applied to new bindings.

**This is why LicenseSpring's offline machinery is unnecessary.** Activation files, deactivation files and
air-gapped portals exist to make a *hard* offline gate safe. This gate is soft by construction.

## 0.2b The CLI owns the licence; the connector keeps the cache warm

**Revised 2026-07-29.** An earlier draft had the connector own validation. That was backwards: Volt *is* a CLI
tool, the connector is a supervisor for IDE bridges, and this design already requires the CLI to work with the
connector stopped, crashed or never installed. Making the CLI depend on a tray app being alive inverts the
dependency.

```
volt login            explicit, interactive, blocking → Polar /activate → store {key, activationId}
volt push/pull/merge  read the cached verdict, NO network call
connector             always-on: refreshes the cache before it goes stale, shows state, warns
```

**Ownership:** the CLI owns the credential, the cache format and the login flow. `volt login` is the idiom
engineers already expect from `gh`, `wrangler` and `docker`.

**The connector is an accelerator, not the owner.** Being always-on, it has no process-lifetime problem, so it
can refresh on a schedule and keep the cache fresh enough that the CLI never needs to. It reads and writes the
same cache. Remove it and everything still works — the CLI refreshes opportunistically instead.

**Routine commands never block on the network.** A fresh cache means no request at all. A stale cache does not
block a mutating verb either: the CLI uses what it has and refreshes on a cheap command, with a short timeout.
Offline simply means no refresh happens, and §0.2's grace applies.

**Where the credential lives: user-level, not repo-level.** `.git/volt/config.json` is *per project and inside
a git repo* — a licence key must never land there. It belongs somewhere per-user/per-machine.

**Both the key and the `activationId` must be persisted.** Polar's `/activate` returns an activation id, and
`/validate` requires it whenever activation limits are enabled. Storing only the key would break validation on
the second call.

**One activation per machine, not per component.** Volt ships four things that can act on a licence: the CLI,
the connector, the VS Code extension and the desktop app. Polar counts activations per *device instance*, so if
each called `/activate` independently a single workstation would consume four. They share one credential and
one activation, held by the CLI — which is a second reason the CLI owns it (§0.2b), beyond the dependency
argument.

**Free never contacts Polar at all.** With no key there is nothing to validate, so the 3-project allowance is
enforced entirely locally and a free user is fully offline-capable. That also means the allowance is
unverifiable — accepted in §0.1.

## 0.2c Can the client call Polar directly? — almost certainly yes, confirm anyway

The endpoint is `/customer-portal/license-keys/validate` — the *customer portal* namespace, which implies
end-user use by design. Community integrations report it *"doesn't require authentication and can be safely
used on a public client, like a desktop application or a mobile app"*, and `organization_id` is an identifier
rather than a secret. Polar's own API reference does not state it in as many words, so it remains a
confirm-before-building item rather than an assumption.

**This must be confirmed before anything is built**, because it is the one thing that could reintroduce a
backend:

| answer | consequence |
|---|---|
| callable with the key alone | the CLI calls Polar directly. **No backend**, as designed |
| requires a server-side token | a ~50-line Cloudflare Worker proxies `/validate`. Still small, but "no backend at all" becomes "one endpoint" |

Even in the worse case the proxy holds no state and no database — so the shape of this change survives either
way. It is a pre-flight question, not a design fork.

## 0.2d Polar provides no offline story — the cache and grace are entirely Volt's

Confirmed 2026-07-29: **every licence check is a live API call.** Polar issues no signed offline artifact, has
no grace period and no fallback. Its own guidance is to *"validate the user's license key for each session"*.

Volt deliberately deviates: §0.2b caches a verdict and §0.2 grants 14 days of grace. That is not an
optimisation, it is the only thing standing between an unreliable plant-floor network and an unusable
toolchain — a per-session live call would fail exactly when engineers need the tool most.

Two consequences to accept:

- **The cached verdict is unsigned.** It is a local file a determined user could edit to extend entitlement.
  That is consistent with the project allowance already being client-side and gameable (§0.1); at €19 the
  effort exceeds the saving. If that ever stops being true, the answer is a signed verdict from a Volt
  endpoint, not a different licensing vendor.
- **This is a deviation from vendor guidance**, so it belongs in the code as a comment, not just here. Whoever
  next reads the integration should not "fix" it back to per-session validation.

## 0.2e OPEN — product definition is NOT infrastructure-as-code

`sst.config.ts` today creates the Stripe product, prices, coupons and webhook endpoint declaratively. **Polar
has no Terraform or Pulumi provider**, so that stops being true: the €19 product and its licence-key benefit
are configured in Polar's dashboard, or by a script against their TypeScript SDK.

This is a genuine regression against the principle behind the whole infra effort — *everything as code, nothing
clicked in a dashboard*. Options, undecided:

| | |
|---|---|
| **dashboard, documented** | simplest; the product is configured once and rarely changes. Risk: undocumented drift, and no reproducibility for a fresh environment |
| **a small provisioning script** (`@polar-sh/sdk`) | keeps product + price + benefit in version control and re-runnable. Not declarative, but auditable |

Polar does offer **sandbox and production environments** in its SDKs, which removes the dev/prod concern that
disqualified LicenseSpring's free tier. Whichever option is chosen must cover both.

## 0.3 No database

Polar holds customers, subscriptions and licences. There is nothing left to store.

This dissolves the earlier D1-vs-PlanetScale decision and the request to specify Prisma schemas up front —
there are no schemas, because there are no tables. Should a database ever be needed (teams with Volt-side
state, telemetry aggregation), it is a separate change with its own justification.

## 0.4 No workspaces, for now

`volt-console` put workspaces in from day one so that a team tier would be a tier flip rather than a migration.
That reasoning applied to a Volt-owned database. Polar has its own customer and subscription model, including
multi-seat, so the team story starts there instead.

Accepted consequence: if Volt ever needs workspace state of its own, that is a migration. Judged cheaper than
building and maintaining a database now for a tier that does not exist.

## 0.5 No accounts, no sign-in — the licence key is the credential

There is no Volt login. Polar issues a key on purchase and hosts the portal where the customer manages it.

This reverses the position taken in `volt-console`, which required an account so telemetry could be attributed
to a workspace for diagnosis. That still matters — but the licence key is itself a stable identifier, so
telemetry can be attributed by **hashed key** without Volt operating an auth system.

The real cost is the funnel: no sign-up means no mailing list and no usage signal beyond what Polar reports.
Accepted for now; a newsletter box on `volt-www` is a cheaper way to buy that back if it turns out to matter.

## 0.6 Support — Polar's dashboard, plus the connector's status window

The standalone support portal at `support.${domain}` dies with `packages/console` and is **not** rebuilt.

- **Customer-facing:** Polar's portal — key, devices, expiry, invoices, cancellation.
- **Operator-facing:** Polar's own dashboard shows customers, subscriptions and licence state. With zero
  subscribers there is nothing a bespoke lookup tool would add.
- **Diagnosis:** the connector's status window is where a customer reads their own licence state, which is what
  most support questions will actually be about.

## 0.7 Price — €19/month

Chosen for the buying motion, not to recover a cost. Above roughly €50/month a company purchase usually needs
procurement sign-off, which is fatal without a sales team; €19 sits inside "expense it without asking".

Currency is set by Polar's checkout. Polar is the merchant of record and handles EU VAT, including the B2B
reverse charge, so **no VAT registration or OSS filing is required of Volt** — a task the previous design
carried and this one does not.

**Fees, verified 2026-07-29:** Starter is free at 5% + 50¢; **+1.5% for non-US cards**, which applies to
essentially every European customer. On €19 that is ≈ €1.70 per charge (≈ 8.9%). Pro at $20/month
(3.8% + 40¢ + 1.5%) becomes cheaper above roughly **58 subscribers**. At ~1,000 subscribers Polar costs
perhaps €600/month more than Stripe plus a self-built service — the trigger to revisit.

## 0.8 Zero subscribers — Volt never went live

No migration, no revenue to protect, no live Stripe products to preserve.

This inverts the build order to **delete-first**. There is nothing to keep running while the replacement is
built, and deleting removes the obstacles the rest of the work would otherwise route around — including the
`aws` provider that currently blocks every `sst` command.

## 0.9 The dashboard lives in the C# connector, not on the web

Asked directly: should the dashboard be inside the C# app, as most native tools do? **Yes — and Polar makes it
the obvious answer**, because activation is a plain API call rather than a hosted flow to redirect into.

The split:

| surface | owns |
|---|---|
| **connector** (C#, tray) | show tier and expiry, warn before grace bites, deactivate this device, and offer a GUI path to the same activation the CLI performs |
| **Polar portal** (web) | billing, invoices, payment method, cancellation, device list |
| **`volt-www`** (static) | marketing, pricing, buy button |

Volt builds **no web application**. Billing in a native app is the wrong place — card entry, invoices and tax
belong in a hosted portal — but licence state belongs where the software runs.

Note this is *display and convenience*, not ownership: per §0.2b the CLI owns the credential and the login
flow. The connector surfaces that state and offers a GUI route to it, because a tray user should not have to
open a terminal — but it is reading the CLI's cache, not maintaining its own.

This is how most native tools behave: activation in-app, billing on the web.
