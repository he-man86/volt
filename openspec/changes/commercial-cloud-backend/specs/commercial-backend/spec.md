## ADDED Requirements

### Requirement: Volt hosts opencode's commercial backend on its own cloud

Volt SHALL vendor opencode's public commercial packages (pinned to a release tag) and deploy them under Volt's
own provider accounts — Cloudflare, Stripe, and PlanetScale — as a single SST app. The vendored subset SHALL cover
authentication (OpenAuth issuer), the DB (PlanetScale/drizzle), user/account/workspace management, Stripe billing,
**and the LLM gateway** (see the subscription requirement below — the gateway is a load-bearing part of the
product, not excluded). Because the `console/app` web build only runs on Unix, the deploy SHALL run from CI
(GitHub Actions/ubuntu) or a Linux/WSL host, not the Windows dev box.

#### Scenario: The backend deploys and stands up on Volt infrastructure
- **WHEN** the vendored subset is deployed (`sst deploy`, from CI/Linux) with Volt's provider credentials + secrets set
- **THEN** the OpenAuth issuer, the `console/app` frontend, the LLM gateway, and the PlanetScale DB come up on
  Volt's domain, and the drizzle schema is migrated (via `drizzle-kit migrate` — not `push`)

### Requirement: Volt sells metered LLM access, and the agent routes through the gateway

Volt SHALL offer LLM access as a subscription product built on the vendored gateway: it meters each request in real
model cost, enforces per-tier spend allowances + rate limits, and pools upstream provider keys. A subscriber's
opencode agent SHALL be able to route its model calls through the gateway using their subscription key, wired via
`volt-config` (a `provider.volt` block + a `volt-auth` login hook), so the PLC product and the subscription are one
funnel. Pricing SHALL be tiers of a single product differentiated by spend allowance (same models on all tiers).

#### Scenario: A subscriber connects their agent to the gateway
- **WHEN** a subscriber runs `opencode auth login` → Volt → pastes the `sk-` key from their dashboard
- **THEN** the agent's Volt models (e.g. `volt/deepseek-chat`, `volt/claude-…`) route through `zen/v1`, and each
  request is metered against their tier's spend allowance and rate-limited

#### Scenario: The higher tier is the natural upsell
- **WHEN** a subscriber uses the expensive model (Claude) heavily on the entry tier
- **THEN** they exhaust their spend allowance faster than a cheap-model (DeepSeek) user and are prompted to upgrade
  — cost-metering drives the tier upgrade without gating models

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

### Requirement: The backend is observable, with success-rate monitoring

The deployed backend SHALL expose the app's health so operators can see its **success rate** and be alerted to
regressions. It SHALL emit per-request usage/error telemetry to an observability backend (Honeycomb), compute
success/error rates (gateway completions, API 5xx) with alerting to a Volt incident channel, and surface
application errors (via the same telemetry + Cloudflare Workers logs). This is required for operating the
subscription product, though it need not ship in the first deploy.

#### Scenario: Gateway success rate is visible and alerts on regression
- **WHEN** the gateway serves LLM requests and some fail (upstream errors, rate limits, timeouts)
- **THEN** the success/error rate is queryable from the emitted `inference.event` telemetry (which carries
  `status`/`llm.error`/`error_type`), and an alert fires to Volt's incident channel when the error rate exceeds a
  threshold

#### Scenario: Application errors are visible
- **WHEN** the console app, auth issuer, or gateway worker errors on a request
- **THEN** the error is visible via the emitted telemetry (Honeycomb) and Cloudflare Workers logs — no dedicated
  error tracker is required for launch
