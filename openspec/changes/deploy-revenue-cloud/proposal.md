## Why

The revenue path. Deploy the **reused** opencode cloud (the `llm` gateway + `console-core`
billing + Stripe) under Volt's own `infra/`, with a "Volt" hosted-provider entry at
`api.volt.ai`. This is mostly **config + deploy, not new code** — it's the product going
live. Depends on `commercial-landing` (W5) for signup. (VOLT-PLAN phase **W6**.)

## What Changes

- Stand up Volt `infra/` (SST): the `llm` gateway, `console-core` billing, Stripe
  products/keys, SES, DB.
- Add a "Volt" hosted-provider entry (`api.volt.ai`) the agent app points at.
- CI/release wiring.

## Capabilities

### Modified Capabilities
- `monetization`: realizes the metered hosted-subscription model end-to-end.

## Impact

Parallel `infra/` (fork-owned); config; ⚠ `.github/` (CI). Inputs needed: AWS + Stripe + SES
+ provider keys, domain.
