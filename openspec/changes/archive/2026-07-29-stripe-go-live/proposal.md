> ## SUPERSEDED — 2026-07-29
>
> Superseded by `volt-console`, which drops the AI gateway entirely in favour of a flat subscription for the
> PLC toolchain. Its pricing model is metered gateway billing with a 2x markup on token cost. A flat CLI subscription has no COGS and needs pricing designed from scratch — volt-console decision 0.7.
>
> Archived unfinished on purpose: the work is not abandoned so much as no longer applicable. See
> `openspec/changes/archive/2026-07-29-volt-console/` (or `openspec/changes/volt-console/` while in flight).

## Why

The commercial backend deploys with Stripe **test** keys. The full funnel — Google login → Go subscription
(€24/mo) → metered gateway completion — is proven end-to-end on `dev`, but **no real money moves**: test keys
never charge a real card. Turning on real charging is a Stripe-side + secrets change, not a code change (the
billing code is vendored from opencode and already proven). This is the last thing between "works" and "earns."

Split out of `commercial-cloud-backend` (which named "Stripe go-live" as an open gap) so it can be tracked and
done on its own — it's a prerequisite for `console-production-launch` (prod uses these live secrets).

## What Changes

- **Activate the Stripe account** — business profile, identity, bank/payout details — so the account can accept
  live charges (test mode needs none of this).
- **Recreate the product + price in LIVE mode** — the "Volt Gateway" Go product at flat €24/month, matching the
  test-mode config exactly (opencode's auto 50%-off-first-month stays removed, per `billing.ts` divergence).
- **Point a LIVE webhook** at the deployed gateway's Stripe webhook route; capture its signing secret.
- **Set the live secrets** as SST secrets (on the prod stage): `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
  `STRIPE_WEBHOOK_SECRET`, and the live price id — leaving `dev` on test keys so dev never charges.
- **Tax (if charging VAT)** — enable Stripe Tax + the required registrations, or record an explicit decision to
  defer it.
- **Verify a real charge**: subscribe with a live card, confirm €24 is captured, the webhook activates the
  subscription, and the gateway honors it; then refund the verification charge.

## Impact

- **Config/secrets only** — no source edits. The `packages/console/*` billing code is unchanged (test↔live is
  purely which keys/price id are set). Keeps the vendored-console divergence footprint at zero for this change.
- **Docs:** `PROVISIONING.md` — fill in the live-key steps + confirm the 50% margin (2× `models.json` markup)
  holds in live mode.
- **Depends on nothing**; **blocks** `console-production-launch` (prod can't charge without these).

## Non-goals

- Not the production deploy itself (that's `console-production-launch` — this only makes Stripe live-ready and
  stages the live secrets).
- Not changing the pricing/product shape (flat €24/mo stays); this flips test→live, it does not re-price.
