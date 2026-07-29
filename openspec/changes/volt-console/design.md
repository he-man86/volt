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

## 0.1 Tiers — free is a 30-day trial, then read-only

| | days 1–30 | after |
|---|---|---|
| `volt status` / `build` / `show` | ✅ | ✅ |
| LSP + VS Code extension | ✅ | ✅ |
| `volt pull` / `push` / `merge` | ✅ | ❌ |

Pro unlocks the write path — the git-for-PLC workflow that is the actual product. Every user experiences the
full thing before deciding, which suits a tool whose value is not obvious from a feature list.

**Consequences:**

- **An account is required from day one.** There is no fully-offline free tier. Accepted: it costs a signup
  step but gives a funnel and a usage signal, and the trial needs an identity to attach to.
- **Trial start is server-side, per workspace**, set at signup. It must not live on the client or a reinstall
  resets the trial.
- The client's clock is therefore only trusted for the offline grace window (0.2), where tampering buys a
  bounded extension and nothing more.

**Still to decide:** whether the read-only set above is exactly right. It is the current best guess, not a
researched answer — validate against what a PLC engineer can actually do with it.

## 0.2 Enforcement — 14-day offline grace, then degrade to free

```
online              → validate, cache {tier, trialEndsAt, validatedAt}
offline < 14 days   → work normally
offline ≥ 14 days   → degrade to the free capability set, with an explicit message
```

Never refuses to start. Never silently downgrades. Volt runs on plant floors where the network is unreliable
or absent, and a failed HTTP call must not cost an engineer their shift.

**This converges with 0.1**, which is the point: post-trial free and past-grace degraded are the *same*
read-only state. One degraded mode to build, one to explain, one to test.

**Still to decide:** per-machine binding. Binding means device management and a support burden; not binding
means a key can be shared. Deferred until there is evidence it matters.

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

### Consequence: the trial does NOT take a card

0.1 already requires trial start to be server-side per workspace, which means **Volt owns the trial clock, not
Stripe.** Stripe's native `trial_period_days` would be simpler — the tier would just derive from
`subscription.status === "trialing"` — but it requires a card up front, and card-gated trials collapse signup
rates for a tool engineers want to evaluate quietly.

So: sign up → workspace created with `trialStartedAt` → no Stripe object exists yet. A Stripe customer and
subscription are created only at conversion. The licence validate endpoint must therefore answer for
workspaces that have no Stripe record at all.

### Consequence: EU VAT

Selling a subscription into the EU brings VAT obligations, including the B2B reverse charge and OSS reporting.
**Stripe Tax** handles calculation and collection but has to be enabled and configured with the product's tax
code; it is not automatic. Not a blocker for building, but it must be settled before taking real money — add
it to section 1.4.

## 0.7 Price, currency, trial length — OPEN

Trial is 30 days (0.1). Price and currency undecided. The old €24/month was a gateway subscription where Volt
paid for tokens; the customer now brings their own key, so the same number buys them less but costs them less
overall. Supersedes the gateway pricing in `stripe-go-live`.

## 0.8 Existing subscribers — OPEN

Needs a factual answer before assuming migration is a footnote.
