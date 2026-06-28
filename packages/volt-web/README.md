# @opencode-ai/volt-web

> Volt's public landing/marketing site (`volt.ai`) — the one frontend Volt fully owns. **Scaffold.**

Volt's own **website** — the `volt.ai` landing/marketing page. It's the single frontend Volt fully owns; everything else (the agent GUI, the backend) is reused from opencode and kept in sync. **Status: scaffold** — this package reserves the workspace slot and records the plan; the UI isn't built yet.

## Role in Volt

Volt is a white-label of opencode (root `CLAUDE.md` → "Fork surface"). The guiding split is **own what's purely yours, sync what _is_ the product**:

| Surface | opencode package | Volt move |
|---|---|---|
| **Public landing page** | `console/app` (`src/routes/index.tsx`) | **Own it fully → this package.** Volt branding/copy/pricing; opencode's landing is throwaway to us, never synced. |
| **Agent GUI** | `app` + `ui` + `desktop` | **Keep + sync as upstream deps** — _this is the product_ (chat/sessions/tools), improved daily; customize only via minimal branding seams (logo, app name), never fork. |
| **Backend** | `@opencode-ai/console-core` | **Reuse as-is** — point its SST `Resource.*` at Volt's Stripe keys/prices, SES domain, DB. Config, not code. |

So `volt-web` (this) and opencode's `console/app` become two parallel frontends over one shared backend (`console-core`).

## How it works (planned)

- A **solid-start** app (same framework as `console/app`) so it can import `@opencode-ai/console-core` server-side for signup / auth / billing exactly the way `console/app` does (`"use server"` functions + `routes/api`).
- Deployed at Volt's domain (`volt.ai`, TBD) via Volt's **own `infra/`** SST stack — a parallel to opencode's `infra/`, bound to Volt's AWS / Stripe / SES resources.
- Homepage modeled on `console/app/src/routes/index.tsx` (hero, install, features, pricing) but with Volt branding and PLC messaging.

**Not** a fork of `packages/app` (the agent GUI stays a synced upstream dep), **not** a backend rewrite (`console-core` is reused as-is), and **not** a monolith (the agent app, the backend, and this site are separate, each with one job). `volt-marketplace` / `volt-commerce` were dropped — no marketplace; billing is reused from `console-core`.

## Commands

None yet — scaffold (empty `scripts`). The build plan (not started):

1. Add deps mirroring `console/app`: `@solidjs/start`, `solid-js`, `vite`, `@opencode-ai/console-core`.
2. Scaffold solid-start: `app.config.ts`, `src/entry-{client,server}.tsx`, `src/routes/index.tsx`.
3. Build the landing `index.tsx` (Volt hero / features / pricing) + brand assets under `src/asset/`.
4. Wire auth / billing by importing `console-core` in `"use server"` functions; deploy via Volt's `infra/` SST stack (domain + `Resource.*` for Stripe / SES / DB).

## Layout

Scaffold — only `package.json` + this README so far. The planned tree mirrors `console/app` (solid-start: `app.config.ts`, `src/routes/`, `src/entry-{client,server}.tsx`, `src/asset/`).

## See also

- [`../../VOLT-DESIGN.md`](../../VOLT-DESIGN.md) — product/architecture overview (own-vs-sync, deployment, the W5/W6 build phases).
- [`../../CLAUDE.md`](../../CLAUDE.md) — the fork-surface guide.
- [`../console-core`](../console-core) (upstream) — the reused billing/auth/email backend.
