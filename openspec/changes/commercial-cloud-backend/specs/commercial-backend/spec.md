## ADDED Requirements

### Requirement: Volt hosts opencode's commercial backend on its own cloud

Volt SHALL vendor opencode's public commercial packages (pinned to a release tag) and deploy them under Volt's
own provider accounts — Cloudflare, AWS, Stripe, and PlanetScale — as a single SST app. The vendored subset
SHALL cover authentication (OpenAuth issuer), the DB (PlanetScale/drizzle), user/account/workspace management,
and Stripe billing. It SHALL NOT include opencode's LLM-gateway product surface (provider/model/key/lite/referral).

#### Scenario: The backend deploys and stands up on Volt infrastructure
- **WHEN** the vendored subset is deployed (`sst deploy`) with Volt's provider credentials and secrets set
- **THEN** the OpenAuth issuer, the `console/app` frontend, and the PlanetScale DB come up on Volt's domain, and
  the drizzle schema (account/auth/user/workspace/billing) is migrated

### Requirement: Signup drives a Stripe checkout and persists a subscription

A user SHALL be able to sign up through one deployed surface and reach Stripe Checkout, with the resulting
subscription persisted to Volt's DB via the vendored billing/webhook path — proving the backend works end-to-end
before any Volt-specific product adaptation.

#### Scenario: End-to-end signup → checkout → subscription row
- **WHEN** a user signs up and starts a subscription against the Volt Stripe account
- **THEN** they are redirected to Stripe Checkout, and on completion the webhook persists account/user/workspace
  and a subscription row in the Volt DB

### Requirement: opencode-product coupling is isolated, not adopted

The bring-up SHALL keep opencode-product-specific coupling (the Zen/lite billing product and its Stripe price IDs,
opencode branding in the console app and mail templates) explicitly documented as adaptation debt, so it is
swapped for Volt's product in a separate follow-up change rather than silently shipped as Volt's.

#### Scenario: Coupling is recorded for the adapt follow-up
- **WHEN** the "deploy as-is" bring-up is complete
- **THEN** the opencode-shaped billing product, price IDs, and branding are listed as items the follow-up
  `adapt-commercial-backend` change must rewrite

### Requirement: The backend is observable, with error tracking and success-rate monitoring

The deployed backend SHALL expose the app's health so operators can see its **success rate** and be alerted to
regressions. It SHALL emit per-request usage/error telemetry to an observability backend (Honeycomb), compute
success/error rates (gateway completions, API 5xx) with alerting to a Volt incident channel, and capture
application exceptions in an error tracker (Sentry). This is required for operating the subscription product,
though it need not ship in the first deploy.

#### Scenario: Gateway success rate is visible and alerts on regression
- **WHEN** the gateway serves LLM requests and some fail (upstream errors, rate limits, timeouts)
- **THEN** the success/error rate is queryable from the emitted `inference.event` telemetry, and an alert fires to
  Volt's incident channel when the error rate exceeds a threshold

#### Scenario: Application exceptions are captured for debugging
- **WHEN** the console app, auth issuer, or gateway worker throws an unhandled exception
- **THEN** it is reported to Sentry with a stack trace and release context
