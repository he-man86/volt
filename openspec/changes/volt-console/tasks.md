> Read `proposal.md` first — in particular **"Open questions — decide before building"**. Section 0 is those
> decisions, and nothing below it should start until they are made. Building the licence check before deciding
> what free vs pro actually *is* would mean building a gate with nothing to gate.

## 0. Decide (no code)

> **Decisions are recorded in `design.md`.** 0.0 (fewest providers) governs the rest: prefer an extra
> Cloudflare product over an extra platform. Target end state is three providers — Cloudflare, Stripe, GitHub.

- [x] 0.1 **Tier contents.** What free includes, what pro unlocks, whether free needs an account. Write it as a
      feature table in `design.md` — this is the input to every other task.
- [x] 0.2 **Enforcement policy.** Hard gate vs soft degrade; offline grace duration; behaviour when grace
      expires offline; per-machine binding or not. Bias toward not breaking an engineer mid-shift.
- [x] 0.3 **Database.** Stay on PlanetScale or move to Cloudflare D1. Decide against expected scale (tens to
      low hundreds of subscribers), cost, and the fact that D1 is SST-provisionable.
- [x] 0.4 **Workspaces from day one, or later?** Present from the start makes team a tier flip; deferring is
      simpler now and a migration later.
- [x] 0.5 **Auth.** GitHub + Google + email code; transport is Cloudflare Email Sending, not SES.
- [x] 0.6 **Support portal** — folded into `volt-console` or left as its own worker.
- [x] 0.7 **Price, currency, trial.** Supersedes the gateway pricing in `stripe-go-live`.
- [x] 0.8 **Zero subscribers — Volt never went live.** No migration, no revenue to protect, no live Stripe
      products to preserve. This inverts the build order; see "Ordering" at the bottom.

## 1. Scaffold `packages/volt-console`

- [ ] 1.1 New package. Pick the framework deliberately rather than inheriting SolidStart — `volt-www` is
      React/Vite, and one frontend stack across the product is worth more than reusing vendored code.
- [ ] 1.2 Port the data model *by hand* from opencode's shape (proposal.md): `account`, `auth`, `workspace`,
      `user`, `billing`, `key`. Leave out `benchmark`, `ip`, `model`, `provider`, `referral`. Target is D1
      (sqlite dialect), so drizzle's mysql-specific column types need translating rather than copying.
- [ ] 1.3 Auth: sign in, session, and workspace membership per 0.5.
- [ ] 1.4 Stripe: Checkout for subscribe, Customer Portal for manage/cancel/invoices. Both are hosted — do not
      rebuild them. `checkout.session.completed` issues the licence key. €19/month in EUR (0.7).
      **No card until conversion** — a free workspace has no Stripe customer, subscription or payment method
      at all (0.1 has no trial to gate). The validate endpoint must resolve "no Stripe record" to free rather
      than to an error.
      **Enable Stripe Tax** and set the product's tax code: EU VAT, B2B reverse charge and OSS reporting apply
      and are not automatic. Settle before taking real money.
- [ ] 1.5 Dashboard: current tier, licence key (copyable, revocable), link to the portal.
- [ ] 1.5b `/admin/lookup` — the support portal, folded in per 0.6, gated by an operator email allow-list
      (`CONSOLE_DEV_EMAILS` is the existing pattern). Replaces the standalone `support.${domain}` worker.
- [ ] 1.6 Infra as code, SST, in the existing `infra/` — one Worker, the DB from 0.3, the Stripe product/price,
      secrets. `infra/www.ts` was 17 lines; this should be the same order of magnitude.

## 2. Licence system

- [ ] 2.1 Issue: a key per workspace, on `checkout.session.completed`. Store status + tier.
- [ ] 2.2 **Reconciliation.** A missed webhook must not leave a paying customer keyless — a poll or a
      "refresh my subscription" action that reads Stripe as the source of truth.
- [ ] 2.3 Validate endpoint: key → `{ tier, active, maxProjects }`. Cheap, cacheable, no auth beyond the key.
      Must answer for workspaces with no Stripe record (free).
- [ ] 2.4 CLI side: hold the key, check on a schedule, cache the result, honour the grace policy from 0.2.
      Enforce `maxProjects` against the CLI's OWN count of bound repos — do not register project identifiers
      with the server (0.1). Decide where the key lives on disk and who can read it.
- [ ] 2.5 Revocation + rotation, and what the CLI does when a key is revoked mid-grace.
- [ ] 2.6 Tests for the enforcement paths — revoked, offline-within-grace, offline-past-grace-on-an-existing-
      project (must keep working), offline-past-grace-binding-a-new-one (must refuse with a clear message), and
      at-the-allowance-boundary. This sits in front of every paying customer; it is the one part that must not
      be discovered in production.

## 3. Delete the gateway and the vendored console

> **Do this FIRST** (see Ordering). With zero subscribers there is nothing to protect, and deleting first means
> sections 1–2 get built on a clean, cheap base instead of alongside a gateway that has to keep working.

- [ ] 3.1 Delete `packages/console`.
- [ ] 3.2 Remove the gateway's infra: Upstash secrets, `ZenData` / `ZenDataNew` / `Bucket`, the LogProcessor
      worker, `ZEN_MODELS1..30`, `ZEN_LIMITS`, and the provider API keys.
- [ ] 3.2b Per design.md 0.0, also remove the vendors the gateway was the reason for: PlanetScale (→ D1),
      AWS SES (→ Cloudflare Email Sending: delete `core/src/aws.ts`, the `aws4fetch` dep and both `AWS_SES_*`
      secrets), and Honeycomb (→ Workers Logs: delete `infra/monitoring.ts`, the `honeycombio` provider, and
      both Honeycomb keys). Verify each disappears from the bill.
- [ ] 3.3 Remove the two client-side files: the `provider.volt` block in `opencode-config/opencode.json` and
      `opencode-config/plugins/volt-auth.ts`. Verify `bun run compat` still passes — the LSP, the `volt` tool
      and the permission gates are unaffected and must stay working.
- [ ] 3.4 Delete the model-catalog scripts (`update-models`, `promote-models`, `pull-models`) and the
      authoring-stage machinery documented in `infra/README.md`.
- [ ] 3.5 Update `infra/README.md`: most of groups A–G are about opencode's console and stop applying. Keep the
      parts that still describe Volt's own infra.
- [ ] 3.6 Update `CLAUDE.md` — the vendored-console rule, the `packages/console` description, and the two-
      package commercial-side claim all become wrong.
- [ ] 3.7 Archive the superseded changes listed in proposal.md.

## 4. Verify

- [ ] 4.1 A real subscribe → key → CLI validates, end to end on `dev`, with a Stripe test card.
- [ ] 4.2 The same on `production` with a real card, then refunded.
- [ ] 4.3 Offline behaviour: disconnect, confirm the CLI keeps working within grace; past grace confirm
      existing projects still pull/push/merge and only a NEW binding is refused.
- [ ] 4.4 Cancel via the Customer Portal → the key deactivates within the expected window.
- [ ] 4.5 `bun run compat`, `bun volt-scripts/check-wiring.ts`, typecheck and lint all green.
- [ ] 4.6 Confirm the deleted services are actually gone from the bill — Upstash, the R2 buckets, and
      PlanetScale if 0.3 moved off it.

## Ordering — 3 first, then 1, 2, 4

The original plan was build-then-delete, to avoid removing the only thing being sold before its replacement
worked. **0.8 removed that constraint: there are zero subscribers and Volt never went live.** So:

| | | why |
|---|---|---|
| 1st | **3** — delete the gateway + vendored console | nothing to protect, and it removes the obstacles below |
| 2nd | **1** — scaffold `volt-console` | on a clean base, not alongside a gateway that must keep working |
| 3rd | **2** — licence system | |
| 4th | **4** — verify | |

Deleting first is not just safe, it is *easier*. Section 3 removes, in one pass:

- the `aws` provider, which today blocks **every** `sst` command including `sst secret list`
- `ZEN_MODELS1..30` and the provider API keys — 30 of the ~52 declared secrets
- PlanetScale, Upstash, three R2 buckets, the LogProcessor worker and Honeycomb

Every one of those is friction that sections 1–2 would otherwise have to work around. It also stops the bill
immediately rather than at the end of the project.

Two further consequences of zero subscribers:

- **The live Stripe products can simply be deleted and recreated** at €19 (0.7). Task 3 no longer needs to
  preserve `ZenLite` / `ZenBlack` or their coupons, and group F's "changes live Stripe products" caution in
  `infra/README.md` is moot.
- **`infra/README.md` group D shrinks**: only `www.ts` needs restoring. `support.ts` is not coming back — the
  portal folds into `volt-console` per 0.6.
