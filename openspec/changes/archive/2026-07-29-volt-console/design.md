# Design — decisions

Section 0 of `tasks.md`. Decisions taken 2026-07-29 unless noted.

## 0.0 Governing principle — fewest providers

**Prefer an extra Cloudflare product over an extra platform**, even at higher unit cost. Every additional
vendor is an account, a bill, a dashboard, a set of credentials, an outage page and a support relationship.
Unit price is not the dominant cost at Volt's scale; operational surface is.

Target end state — **three providers**:

| | |
|---|---|
| **Cloudflare** | Workers (compute), D1 (database), Email Sending, DNS, static site, Access, Workers Logs |
| **Stripe** | payments — the one genuinely unavoidable third party |
| **GitHub** | source + Actions |

GitHub and Google remain as OAuth *identity* providers for sign-in. They are free, already configured, and add
no bill, no dashboard to operate and no runtime dependency Volt controls — so they do not count against this
principle.

Consequences, decided here and applied across the other sections:

| need | was | becomes |
|---|---|---|
| database | PlanetScale (~$39/mo, no free tier) | **Cloudflare D1** |
| transactional email | AWS SES (new AWS account, IAM, sandbox approval) | **Cloudflare Email Sending** |
| observability | Honeycomb (`monitoring.ts` 287 lines, 2 distinct API keys, LogProcessor tail worker) | **Cloudflare Workers Logs** — built in, on by default |
| rate limiting | Upstash Redis | gone with the gateway; KV or Durable Objects if ever needed |

Honeycomb is worth naming precisely, because it is easy to assume it does more than it does.
`infra/monitoring.ts` is an **error-rate SLO on the gateway's HTTP responses** — it filters on
`event_type = "completions"` and `user_agent contains "opencode"`, computes
`IF(GTE($TOTAL, 150), DIV($FAILED, $TOTAL), 0)` and alerts Discord. It never observes the LSP, the CLI or
anything client-side, and it has nothing to do with chat content. It dies with the gateway and nothing of
product value is lost. The *desire* it gets confused with — understanding real-world LSP and agent behaviour —
is a separate follow-up, recorded in `proposal.md`.

## 0.1 Tiers — free is 3 projects, pro is unlimited

**Revised 2026-07-29**, replacing a 30-day trial. Not time-limited at all.

| | free | pro |
|---|---|---|
| bound projects | **3** | unlimited |
| capability on a bound project | full — `pull`/`push`/`merge`, LSP, extension | full |

A "project" is concrete: a git repo root carrying `.git/volt/config.json` (vendor + project name) — one
CODESYS or TwinCAT project, in practice one machine or line.

**Why this beats a 30-day trial:**

- **It removes the clock from tier enforcement.** A trial needs `now > trialStartedAt + 30d`, which is a second
  clock alongside the offline grace window in 0.2. A count is a fact the client can already see.
- **It does not punish slow evaluation.** Try it for three days, come back in two months, and a trial is gone;
  a project allowance is not.
- **It is a permanent funnel rather than one-shot urgency.** Lapsed trial users disappear. Free-tier users stay
  in the ecosystem and convert when they grow.
- **Usage-aligned:** you pay when you are getting more value, not when a timer runs out.

**The risk, accepted:** an engineer with one or two machines never pays. 3 is set low enough that most
professionals cross it — a plant engineer maintains many machines, a machine builder ships dozens a year — and
whoever stays under three was unlikely to convert regardless.

**Where the count lives: client-side.** The licence response carries `maxProjects`; the CLI counts its own
bindings. Server-side counting would mean `volt init` registering a project identifier with Volt, which
contradicts the privacy line drawn for telemetry (proposal.md → Follow-ups: never ship identifiers). Client-side
is gameable by deleting `.git/volt` and re-running `init`, but that is deliberate effort to dodge €19.

**Free requires an account.** Decided 2026-07-29. The counter would have allowed a fully offline free tier
(default to 3 with no key present), which is less friction — but an account buys three things worth more:

- **Diagnosis.** Telemetry attributed to a workspace lets a support conversation start from "your LSP is
  raising this" rather than "can you reproduce it". Anonymous telemetry answers aggregate questions only.
- A funnel and a usage signal, neither of which exist otherwise.
- One code path: every workspace has a licence key, free or pro.

This tightens the privacy constraint rather than loosening it — attributed telemetry is *more* sensitive, so
the "codes and counts, never source or identifiers" rule in the telemetry follow-up becomes more load-bearing,
not less.

## 0.2 Enforcement — 14-day offline grace, then "keep what you have, add nothing new"

```
online              → validate, cache {tier, maxProjects, validatedAt}
offline < 14 days   → work normally
offline ≥ 14 days   → existing bound projects keep working; binding a NEW one is blocked,
                      with an explicit message
```

Never refuses to start. Never silently downgrades. Volt runs on plant floors where the network is unreliable
or absent, and a failed HTTP call must not cost an engineer their shift.

**The project counter makes this materially kinder than the trial design it replaces.** Under a time trial, a
pro user offline past grace degraded to *read-only* — precisely the stranded-engineer scenario this section
exists to prevent. Under a counter, an engineer offline for three weeks keeps working on every project they
already have, and only meets a wall when starting something new, which is exactly the moment reconnecting is
reasonable.

It also means there is no separate "degraded mode" to design: past-grace behaviour is just the free tier's
allowance applied to new bindings, and a user already within their allowance notices nothing at all.

**Still to decide:** per-machine binding. Binding means device management and a support burden; not binding
means a key can be shared. Deferred until there is evidence it matters.

## 0.2b The connector owns licence validation, not the CLI

The always-on tray connector (`packages/volt-cli/src/Volt.Cli.Connector`) is the right holder of the licence,
not the `volt` CLI. It already:

| | |
|---|---|
| `LoginItem.cs` | starts at login — it is always running |
| `Updater.cs` | already phones home on a schedule, so licence validation is the same cadence, not a new one |
| `TrayContext.cs`, `StatusWindow.cs` | somewhere to *show* licence state and warn before grace bites |
| `BridgeSupervisor.cs` | already tracks what is bound |

**The decisive reason: `volt push` must not make a network call.** Validating per CLI invocation would add an
HTTP round-trip to every operation an engineer performs. Instead the connector validates on its schedule and
writes a cached verdict locally; the CLI reads that file and does no networking at all.

**The cache file is the contract, not the connector.** The CLI must work when the connector is not running —
stopped, crashed, or never installed (the CLI can be used standalone). It reads the last cached verdict and
applies the same grace rules. A missing cache means free tier, not failure.

This also gives a natural place to warn *before* something bites: the tray can say "licence unverified for 11
days" long before the 14-day grace expires, which is far better than discovering it mid-task.

Wiring this up is future work, not part of section 2 — but the licence design should assume it, so the CLI
never grows a network path that has to be removed later.

## 0.3 Database — Cloudflare D1

SQLite, native to Workers, SST-provisionable, free tier of 10 GB / 5M reads per day. The schema is being
hand-ported anyway, so the MySQL → SQLite move costs almost nothing *now* and would be expensive later.

PlanetScale was sized for the gateway's load, which is gone, and has no free tier.

## 0.4 Workspaces — present from day one

Every account gets a workspace, 1:1 and invisible in the UI until a team tier exists. The licence key belongs
to the **workspace**, not the account.

Team then becomes a tier flip plus an invite UI, with **no data migration**. opencode's `User.invite` and
`joinInvitedWorkspaces` already implement exactly this and are worth copying.

## 0.5 Auth — GitHub + Google + email code, all on Cloudflare

Keep GitHub and Google: already configured, working, and free to operate.

**Add email code.** GitHub is a developer-audience assumption inherited from opencode; a plant automation
engineer may have no GitHub account, and industrial IT may block it. Email works for everyone.

The `CodeProvider` is already imported and commented out at `function/src/auth.ts:64`, so the flow is sketched.

**Email transport is Cloudflare Email Sending**, not SES (per 0.0). Verified against the docs 2026-07-29:

- Workers **Paid** required — Free cannot send outbound at all. 3,000 emails/month included, then $0.35/1,000.
  At Volt's scale that is $0.
- Requires Cloudflare DNS — already true for `volt-ai.dev`.
- **No sandbox gate.** Onboard the sending domain and *"you can send to any recipient immediately"* — unlike
  SES, where reaching unverified addresses needs an AWS approval with real lead time.
- Domain onboarding adds MX/SPF/DKIM/DMARC automatically; DKIM and ARC signing are automatic.
- Three transports available: Workers binding, REST API, SMTP.

**Two caveats, accepted:**

- **Public beta** (since 2026-04-16). Acceptable *because* email is a third option behind GitHub and Google,
  not sole-auth. It would be a poor risk if it were the only door.
- **New accounts start on a conservative daily quota** that scales with sending reputation. Request an
  increase before launch rather than discovering it when ten people sign up at once.

**Consequences:** `core/src/aws.ts`, the `aws4fetch` dependency and both `AWS_SES_*` secrets are deleted. The
`mail/` JSX templates carry over unchanged — they only produce HTML, the transport underneath changes.

**Open:** whether SST's Cloudflare Worker component can declare a `send_email` binding. If not, use the REST
API with an API token secret — same result, and it works from outside Workers too.

## 0.6 Support portal — folded into `volt-console` as an operator-gated route

```
volt-console/
  /                 customer dashboard
  /admin/lookup     operator-only
```

One worker, one deploy, one auth system. It reuses the workspace and subscription queries the dashboard needs
anyway, rather than porting a second copy of them into a standalone app.

Gate on an operator email allow-list. `CONSOLE_DEV_EMAILS` already does exactly this in the vendored console
(read by `function/src/auth.ts` and `go/lite-section.tsx`), so the pattern carries over.

Replaces today's separate worker at `support.${domain}` behind Cloudflare Access, which dies with
`packages/console`. Dropping Cloudflare Access here is a small simplification — one fewer thing to configure —
though Access remains available if the admin surface ever needs stronger isolation.

## 0.7 Price — €19/month, EUR

**€19/month, charged in EUR.**

Chosen for the buying motion, not to recover a cost. Above roughly €50/month a company purchase usually needs
procurement sign-off, which is fatal when there is no sales team; €19 sits comfortably inside "expense it
without asking", so an engineer can buy it on a company card the same day they evaluate it. Self-serve is the
only motion Volt has.

EUR because the buyers are European automation houses — CODESYS and Beckhoff heartland — and it is already the
configured currency.

For reference: 100 subscribers ≈ €22.8k ARR, at near-zero COGS now that Volt does not pay for tokens. It also
leaves room for a team tier around €15/seat without the individual price looking wrong.

### Consequence: the free tier has no Stripe object at all

No credit card is involved until someone goes pro. With 0.1's project counter there is no trial to gate either,
so a free workspace is simply a workspace with `maxProjects = 3` and **no Stripe customer, subscription or
payment method in existence**.

That has one implementation consequence worth building in from the start rather than retrofitting: **the
licence validate endpoint must answer for workspaces with no Stripe record.** Deriving tier from Stripe (a
requirement in the spec) means "no Stripe record" has to resolve to free, not to an error or an empty result.

A Stripe customer and subscription are created only at conversion, through hosted Checkout.

### Consequence: EU VAT

Selling a subscription into the EU brings VAT obligations, including the B2B reverse charge and OSS reporting.
**Stripe Tax** handles calculation and collection but has to be enabled and configured with the product's tax
code; it is not automatic. Not a blocker for building, but it must be settled before taking real money — add
it to section 1.4.

## 0.8 Existing subscribers — none

**Zero subscribers; Volt never went live.** No migration, no revenue at risk, no live Stripe products to
preserve — the existing `ZenLite` / `ZenBlack` products and their coupons can simply be deleted and recreated
at €19.

This inverts the build order to **delete-first** (3 → 1 → 2 → 4); see `tasks.md` → Ordering. Section 3 removes,
in one pass, the `aws` provider that currently blocks every `sst` command, 30 of the ~52 declared secrets, and
the PlanetScale / Upstash / R2 / Honeycomb bill — all of which sections 1–2 would otherwise work around.
