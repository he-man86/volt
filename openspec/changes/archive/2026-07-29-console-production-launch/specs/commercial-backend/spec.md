## ADDED Requirements

### Requirement: The commercial backend serves customers from a production stage

Volt SHALL deploy the commercial backend (console, LLM gateway, marketing site, and the support portal) to a
dedicated **production** SST stage, separate from `dev`, with production secrets, a production PlanetScale
database (schema applied via `drizzle-kit migrate`), and live Stripe credentials. The production deploy SHALL run
from CI or a Linux host (the `console/app` and `support` web builds do not run on Windows). The support portal
SHALL be fronted by Cloudflare Zero Trust Access on the production hostname before it serves customer data, and
the agent-facing default model SHALL be the cheap tier so production users do not default onto the premium model.

#### Scenario: The production funnel works end to end
- **WHEN** the production stage is deployed with production secrets and a user goes through Google login → Go
  subscription → a gateway completion on the production domain
- **THEN** the subscription is charged via live Stripe, the metered completion is served, and no request 500s from
  a missing secret

#### Scenario: The production support portal is gated
- **WHEN** a request reaches `support.<production-domain>`
- **THEN** Cloudflare Zero Trust Access requires an allow-listed operator before any customer-data lookup renders

#### Scenario: The production deploy runs off Windows
- **WHEN** the production stage is deployed
- **THEN** the deploy runs from CI/Linux (never the Windows dev box), because the console/support vite builds
  require a Unix path layout
