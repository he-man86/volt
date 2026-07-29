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

## 0.2b The connector validates, not the CLI

The always-on tray connector (`packages/volt-cli/src/Volt.Cli.Connector`) holds the licence and calls Polar. It
already has everything needed: `LoginItem.cs` (starts at login), `Updater.cs` (already phones home on a
schedule, so validation rides an existing cadence), `TrayContext.cs` + `StatusWindow.cs` (somewhere to *show*
licence state and warn before grace bites), `BridgeSupervisor.cs` (already tracks what is bound).

**The decisive reason: `volt push` must not make a network call.** Validating per invocation would add an HTTP
round-trip to every operation an engineer performs.

**The cache file is the contract, not the connector.** The CLI must work with the connector stopped, crashed or
never installed — it can be used standalone. A missing cache resolves to the free tier, never to a failure.

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
| **connector** (C#, tray) | enter/activate a licence key, show tier and expiry, warn before grace bites, deactivate this device |
| **Polar portal** (web) | billing, invoices, payment method, cancellation, device list |
| **`volt-www`** (static) | marketing, pricing, buy button |

Volt builds **no web application**. Billing in a native app is the wrong place — card entry, invoices and tax
belong in a hosted portal — but licence state belongs where the software runs, and the connector is already
there, already always-on, already has a status window.

This is how most native tools behave: activation in-app, billing on the web.
