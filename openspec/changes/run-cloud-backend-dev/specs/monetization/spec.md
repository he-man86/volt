## ADDED Requirements

### Requirement: Reused cloud backend runs on Volt-owned infra

The reused opencode cloud backend (console + auth + billing) SHALL run under a Volt-controlled
SST stage — our domain, Cloudflare zone, AWS profile, and PlanetScale `volt` database — with
opencode's `packages/*` backend source unmodified. Infra identity lives in fork-owned
`infra/**` + `sst.config.ts`.

#### Scenario: Console + auth + billing come up on our stage

- **WHEN** an operator runs `bun sst dev --stage volt` after loading `.env` into SST secrets
- **THEN** the console renders on our domain, GitHub/Google sign-in works via the auth worker,
  and a Stripe test checkout is recorded via the `/stripe/webhook` endpoint into the `volt` DB

#### Scenario: AWS and ZEN gateway are scoped out of the first stage

- **WHEN** the stage name is a personal stage (not `dev`/`production`)
- **THEN** AWS lake/stats/monitoring are not provisioned, and the ZEN metered-model path is
  absent (opencode-internal), without blocking console/auth/billing
