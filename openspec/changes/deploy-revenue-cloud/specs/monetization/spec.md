## ADDED Requirements

### Requirement: Full metered hosted product deployed on Volt infra

Volt SHALL deploy the complete hosted product (Zen gateway + `console-core` billing + Stripe + auth +
console UI + observability) on its own accounts and domain, in dependency-ordered phases, reusing
opencode's `packages/*` source unmodified except the documented `@anoma.ly` gate seam. Volt SHALL author
its own model catalog (`ZEN_MODELS*` / `ZEN_LIMITS`), since opencode's is internal.

#### Scenario: A paid subscription drives a billed model call

- **WHEN** a user signs up, subscribes via Stripe, and makes a request to the Zen gateway
- **THEN** the call is authenticated, routed to a provider from Volt's catalog, streamed, metered, and billed
  against the correct billing source, on Volt's stage

#### Scenario: Volt's catalog replaces opencode's internal one

- **WHEN** phase 3 deploys the gateway
- **THEN** `ZEN_MODELS*` + `ZEN_LIMITS` hold Volt-authored provider keys, costs, and limits — not opencode's
