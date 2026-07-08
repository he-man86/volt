## ADDED Requirements

### Requirement: Public landing + signup front door on volt.ai

Volt SHALL serve its own public landing + signup at the root domain (`volt.ai`) from `packages/volt-landing`,
a second SolidStart app over the shared `console-core` backend (there is no SDK/REST API to call). It
replaces `console/app`'s landing role; the opencode docs (`packages/web`) remain a separate site.

#### Scenario: A visitor signs up and subscribes from the landing

- **WHEN** a visitor clicks Sign in, authenticates via the shared OpenAuth issuer, and picks a plan
- **THEN** an account + default workspace are created, a Lite Stripe Checkout is generated via
  `Billing.generateLiteCheckoutUrl`, and the existing `/stripe/webhook` persists the subscription
