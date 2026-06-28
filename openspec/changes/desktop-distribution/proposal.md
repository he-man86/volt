## Why

The desktop app's branding (logo, app name) is done, but it can't ship: there's no
code-signing, no updater feed, and remaining hardcoded `opencode.ai` constants. This blocks
distributing Volt as an installable desktop product. (VOLT-PLAN phase **B ◐**.)

## What Changes

- Replace the remaining `opencode.ai` constants + wire the Volt Sentry DSN.
- Code-sign the Electron build (Windows certs).
- Configure the updater feed.
- Produce a signed release.

## Capabilities

### Modified Capabilities
- (none — branding/release config + infra; no spec-level requirement change.)

## Impact

⚠ seams already taken: `packages/ui/logo.tsx` (logo), `packages/desktop` (app name).
This change touches `electron-builder.config.ts` (signing/updater) + release config.
Inputs needed: Windows signing certs.
