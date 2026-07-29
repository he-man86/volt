## ADDED Requirements

### Requirement: Production billing charges real payment methods via live Stripe

In production, Volt SHALL bill subscribers with **live-mode** Stripe credentials — a live secret key, live
publishable key, live webhook signing secret, and a live-mode price for the Go product (flat €24/month, with no
first-month discount) — so a real card is actually charged. Non-production stages (`dev`) SHALL continue to use
**test-mode** Stripe keys so they never charge a real payment method. The switch SHALL be configuration only (the
vendored billing code is not modified); the live price id SHALL be read from a secret/linkable, not hardcoded.

#### Scenario: A production subscription charges a real card
- **WHEN** a user subscribes to Go on the production site with a real payment method
- **THEN** Stripe captures €24 with the live keys, the live webhook activates the subscription, and the gateway
  honors it for metered completions

#### Scenario: Dev never charges real money
- **WHEN** the same flow runs on the `dev` stage
- **THEN** it uses test-mode Stripe keys and no real payment method is charged
