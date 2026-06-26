# @opencode-ai/volt-web

Volt's own public **website** — the landing / marketing site (the `volt.ai` homepage).
This is the **one** frontend Volt fully owns; everything else (the agent app, the
backend) is **reused from opencode and kept in sync**.

> **Status: scaffold.** The landing UI is not built yet — this package records the
> plan and reserves the workspace slot. See "Build plan" below.

## Why this package exists

Volt is a white-label of opencode (see the root `CLAUDE.md` → "Fork surface"). The
guiding split is **own what's purely yours, sync what *is* the product**:

| Surface | opencode package | Volt move |
|---|---|---|
| **Public landing page** | `packages/console/app` (`src/routes/index.tsx`) | **Own it fully → this package.** Volt branding/copy/pricing; opencode's landing is throwaway to us. Never synced. |
| **Agent GUI** | `packages/app` + `packages/ui` + `packages/desktop` | **Keep + sync as upstream deps.** This *is* the product (chat/sessions/tools), improved daily. Customize only via minimal branding seams (logo, app name) — **never fork it.** |
| **Backend** | `@opencode-ai/console-core` (billing/Stripe, auth, email/SES, accounts) | **Reuse as-is.** Point its SST `Resource.*` at *our* Stripe keys, prices, SES domain, DB. Config, not code. |

So `volt-web` (this) and opencode's `console/app` become **two parallel frontends over
one shared backend (`console-core`)**.

## What it will be

- A **solid-start** app (same framework as `console/app`) so it can import
  `@opencode-ai/console-core` server-side for signup / auth / billing exactly the way
  `console/app` does (`"use server"` functions + `routes/api`).
- Deployed at Volt's domain (`volt.ai`, TBD) via Volt's **own `infra/` SST stack** — a
  parallel to opencode's `infra/`, bound to Volt's AWS / Stripe / SES resources.
- Homepage modeled on `packages/console/app/src/routes/index.tsx` (hero, install,
  features, pricing) but with Volt branding and PLC messaging.

## Build plan (next steps — not done yet)

1. Add deps mirroring `console/app`: `@solidjs/start`, `solid-js`, `vite`,
   `@opencode-ai/console-core`.
2. Scaffold solid-start: `app.config.ts`, `src/entry-{client,server}.tsx`,
   `src/routes/index.tsx`.
3. Build the landing `index.tsx` (Volt hero / features / pricing) + brand assets under
   `src/asset/`.
4. Wire auth/billing by importing `console-core` in `"use server"` functions (mirror
   `console/app`).
5. Stand up Volt's `infra/` SST stack (domain + `Resource.*` for Stripe / SES / DB).

## What this is NOT

- **Not** a fork of `packages/app` — the agent GUI stays a synced upstream dependency.
- **Not** a backend rewrite — `console-core` is reused as-is (your config).
- **Not** a monolith — the agent app, the backend, and this site are separate, each with
  one job.

## Deferred / dropped

- **Desktop/GUI branding** (logo → `packages/ui`, app name → `packages/desktop`): minimal
  upstream seams or a tiny override package *later*, only when a feature needs it. Not here.
- ~~`volt-marketplace`~~, ~~`volt-commerce`~~ — **dropped.** No marketplace; billing is
  reused identically from `console-core`, not rewritten.
