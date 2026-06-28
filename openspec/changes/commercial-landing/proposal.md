## Why

Volt needs a public landing + signup page (`volt.ai`) — the one frontend Volt fully owns —
to acquire users for the hosted-subscription product. Today `packages/volt-web` is an empty
scaffold (just `package.json` + README). (VOLT-PLAN phase **W5**.)

## What Changes

- Build the `volt-web` landing site (branding, copy, pricing), modeled on `console/app`'s homepage.
- Wire signup through the reused `console-core` backend.

## Capabilities

### Modified Capabilities
- `monetization`: the landing + signup is the front door to the hosted-subscription model.

## Impact

`packages/volt-web` (fork-owned, no upstream seams). Inputs needed: branding/copy, domain.
