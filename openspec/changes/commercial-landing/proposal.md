## Why

Volt needs a public landing + signup page (`volt.ai`) — the one frontend Volt fully owns — to acquire
users for the hosted-subscription product. `packages/volt-landing` now has a **wired SolidStart skeleton**
(framework config + OpenAuth login flow + a Lite Stripe-checkout action reusing `console-core`); what
remains is the **design** (branding/copy/pricing) and finishing the auth/billing surface. (VOLT-PLAN phase **W5**.)

## What Changes

- **Design + build the landing** (`volt-landing`): hero, features, pricing, Volt branding + PLC messaging.
- **Finish the backend wiring** already scaffolded. Key architecture (confirmed against `console/app`):
  the console has **no SDK and no REST data API** — every server call is a SolidStart `"use server"`
  function importing `console-core` directly. So `volt-landing` is a **second SolidStart app over the same
  backend**, not an API client. What that means concretely:
  - **Auth** = the only real external HTTP service: the OpenAuth issuer at `VITE_AUTH_URL` (clientID `"app"`).
    Login flow (`/auth/authorize` → issuer → `/auth/callback`) is scaffolded, mirroring `console/app`.
    Session = httpOnly cookie encrypted with **`ZEN_SESSION_SECRET`** — share that secret to share login with the console.
  - **Signup → plan → Stripe** = Flow A: a `"use server"` action → `Billing.generateLiteCheckoutUrl` →
    redirect to Stripe Checkout → opencode's existing `/stripe/webhook` (same Stripe account + DB) persists it.
    volt-landing needs **no webhook of its own**. Scaffolded in `src/server/billing.ts`.
  - **Dashboard data** (keys/usage/billing), if added later, = copy `getActor`/`withActor` from `console/app`
    and re-declare `query`/`action` server functions over `console-core` — there is no endpoint to call.
- **Infra:** a `volt-landing` SolidStart resource in `infra/` linking the **same `Resource.*`** as `console/app`
  (`ZEN_SESSION_SECRET`, `STRIPE_SECRET_KEY`, `Database`, price linkables) + the `VITE_*` env, on `volt.ai`.

## Capabilities

### Modified Capabilities
- `monetization`: the landing + signup is the front door to the hosted-subscription model.

## Impact

`packages/volt-landing` (fork-owned) + one `infra/` SolidStart resource. Depends on the backend from
`run-cloud-backend-dev` / `deploy-revenue-cloud` (shared auth + Stripe + DB). Dev gotcha: non-prod stages
reject non-`@anoma.ly` emails (`console/function/auth.ts:141`) — use an `@anoma.ly` email in dev or run prod.
Inputs needed: branding/copy, domain, the shared `ZEN_SESSION_SECRET`.
