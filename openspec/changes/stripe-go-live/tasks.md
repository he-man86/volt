Flip Stripe from test to live so a real subscriber is actually charged. Config + secrets only — the vendored
billing code is unchanged. Live secrets target the prod stage (dev stays on test keys).

## Stripe account (dashboard)
- [ ] Activate the account: business profile, identity verification, bank/payout details (required for live charges).
- [ ] Recreate the **Volt Gateway — Go** product + price in LIVE mode at flat **€24/month** (match the test-mode
      config; no 50%-off-first-month — mirrors the `billing.ts` divergence). Capture the live **price id**.
- [ ] Create the LIVE **webhook endpoint** → the deployed gateway's Stripe webhook route (the same events the test
      webhook subscribes to). Capture the live **signing secret**.
- [ ] Tax: enable **Stripe Tax** + register where required for EU VAT — OR record an explicit "defer tax" decision.

## Secrets (SST, prod stage)
- [ ] Set live `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, and the live price id
      (the price-id secret/var the gateway reads). Do NOT touch dev's test keys.
- [ ] Confirm the price-id wiring: `console-core` reads the price from its linkable/secret, not a hardcoded id.

## Verify (real money)
- [ ] Subscribe with a real card on the prod site: €24 is **captured**, the webhook fires, the subscription
      activates, and a metered gateway completion is allowed. Refund the verification charge afterward.
- [ ] Confirm the margin: a real completion bills the subscriber at the 2× `models.json` markup (50% margin).

## Docs
- [ ] `PROVISIONING.md`: fill in the live-key + webhook + tax steps; note the account is activated and the live
      price id.
