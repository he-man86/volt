# monetization — capability preview (NOT a materialized spec)

> **Preview only.** This is the `monetization` capability read as one document — the three active changes'
> `## ADDED Requirements` deltas folded together. It is **not** `openspec/specs/monetization/spec.md` and must not
> be treated as one: the real spec materializes only when the first of these changes archives. Regenerate this by
> re-folding the deltas if they change. Source deltas:
> `changes/run-cloud-backend-dev`, `changes/commercial-landing`, `changes/deploy-revenue-cloud` → `specs/monetization/`.

**Purpose:** the hosted-subscription revenue path — reuse opencode's cloud backend (console + auth + billing) and
the Zen metered-model gateway on Volt's **own** infra, accounts, and domain, fronted by Volt's **own**
landing/signup, shipped in dependency-ordered phases. Backend source (`packages/*`) stays unmodified except the
documented `@anoma.ly` gate seam.

## Requirements

### Requirement: Reused cloud backend runs on Volt-owned infra  ·  *(run-cloud-backend-dev — phase 1, de-risk)*

The reused opencode cloud backend (console + auth + billing) SHALL run under a Volt-controlled SST stage — our
domain, Cloudflare zone, AWS profile, and PlanetScale `volt` database — with opencode's `packages/*` backend source
unmodified. Infra identity lives in fork-owned `infra/**` + `sst.config.ts`.

#### Scenario: Console + auth + billing come up on our stage
- **WHEN** an operator runs `bun sst dev --stage volt` after loading `.env` into SST secrets
- **THEN** the console renders on our domain, GitHub/Google sign-in works via the auth worker, and a Stripe test
  checkout is recorded via the `/stripe/webhook` endpoint into the `volt` DB

#### Scenario: AWS and ZEN gateway are scoped out of the first stage
- **WHEN** the stage name is a personal stage (not `dev`/`production`)
- **THEN** AWS lake/stats/monitoring are not provisioned, and the ZEN metered-model path is absent
  (opencode-internal), without blocking console/auth/billing

### Requirement: Public landing + signup front door on volt.ai  ·  *(commercial-landing — phase 2, owned frontend)*

Volt SHALL serve its own public landing + signup at the root domain (`volt.ai`) from `packages/volt-landing`, a
second SolidStart app over the shared `console-core` backend (there is no SDK/REST API to call). It replaces
`console/app`'s landing role; the opencode docs (`packages/web`) remain a separate site.

#### Scenario: A visitor signs up and subscribes from the landing
- **WHEN** a visitor clicks Sign in, authenticates via the shared OpenAuth issuer, and picks a plan
- **THEN** an account + default workspace are created, a Lite Stripe Checkout is generated via
  `Billing.generateLiteCheckoutUrl`, and the existing `/stripe/webhook` persists the subscription

### Requirement: Full metered hosted product deployed on Volt infra  ·  *(deploy-revenue-cloud — phase 3, launch)*

Volt SHALL deploy the complete hosted product (Zen gateway + `console-core` billing + Stripe + auth + console UI +
observability) on its own accounts and domain, in dependency-ordered phases, reusing opencode's `packages/*` source
unmodified except the documented `@anoma.ly` gate seam. Volt SHALL author its own model catalog
(`ZEN_MODELS*` / `ZEN_LIMITS`), since opencode's is internal.

#### Scenario: A paid subscription drives a billed model call
- **WHEN** a user signs up, subscribes via Stripe, and makes a request to the Zen gateway
- **THEN** the call is authenticated, routed to a provider from Volt's catalog, streamed, metered, and billed
  against the correct billing source, on Volt's stage

#### Scenario: Volt's catalog replaces opencode's internal one
- **WHEN** phase 3 deploys the gateway
- **THEN** `ZEN_MODELS*` + `ZEN_LIMITS` hold Volt-authored provider keys, costs, and limits — not opencode's
