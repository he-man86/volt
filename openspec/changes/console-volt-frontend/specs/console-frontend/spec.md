## ADDED Requirements

### Requirement: Volt customizes the vendored console beside opencode's source, never inside it

`packages/console/*` is vendored opencode source. Volt SHALL NOT edit it to achieve branding, copy, layout, or
product changes. Every customization SHALL take one of three shapes: a **Volt-owned file beside** opencode's (an
overlay, a new route, a new stylesheet), a **deletion declared in `DROPPED`**, or an **import** of opencode's
exported server code. The only permitted edits are a closed, documented set of framework entry points that cannot be
shadowed by a beside-file — `app.tsx`, `entry-server.tsx`, `ui.tsx`, `vite.config.ts`, `middleware.ts`, and
`routes/auth/logout.ts` — each justified in `DIVERGENCE.md`. Adding to that set SHALL require the same justification,
because each entry is a permanent merge cost on every opencode bump.

#### Scenario: A rebrand is requested for vendored copy
- **WHEN** a string opencode owns must read differently for Volt
- **THEN** the change is made as a key in `i18n/volt.ts` and `i18n/en.ts` stays byte-identical to opencode

#### Scenario: An opencode bump lands
- **WHEN** `OPENCODE_VERSION` is raised and the vendored tree is re-synced
- **THEN** only the documented irreducible entry points require a hand-merge, and the divergence gate reports zero
  unexpected drift

### Requirement: A branding overlay merges at the factory every consumer shares

An overlay SHALL be merged at the single point that all consumers — client render **and** server code paths — pass
through, and a test SHALL pin that merge point. Merging an overlay at a render context alone is insufficient: the
console's server call sites (the gateway handler, the rate limiters, the `/auth` callback) build the dict directly
from `i18n()` and never touch the render context, so a context-level merge typechecks, builds, and renders correctly
while shipping opencode's product names to a user's CLI.

#### Scenario: A gateway error reaches a subscriber's CLI
- **WHEN** the gateway emits a user-facing error built from the i18n dict on the server
- **THEN** the Volt overlay's value is used, not opencode's

#### Scenario: The merge point regresses
- **WHEN** the overlay is moved back to a render-context-only merge
- **THEN** `i18n/volt.test.ts` fails

### Requirement: The console serves no marketing, and dormancy is proven rather than assumed

The console SHALL be the account application only; `packages/volt-www` owns Volt's public face. opencode's marketing
routes and their exclusive components SHALL be deleted and declared in `DROPPED`, not kept "byte-identical and
dormant". A route SHALL NOT be treated as dormant on the basis that nothing links to it: SolidStart serves every file
under `routes/**` by URL, so unlinked is not unexposed. Any claim of dormancy SHALL be evidenced by a search for
imports, hrefs, redirects, referral/invite URLs, sitemap entries, and infra URL strings — the four routes previously
labelled dormant (`/go`, `/download`, `bench/submission.ts`, `/black/subscribe`) were each reachable.

#### Scenario: A route is proposed for deletion
- **WHEN** the delete is prepared
- **THEN** it is declared in `DROPPED`, `DIVERGENCE.md` is reconciled, and `console-symmetry` passes

#### Scenario: A marketing page and its components are removed
- **WHEN** the sweep deletes pages and the components only those pages import
- **THEN** both leave in the same change, and `console-build` passes — because SolidStart compiles every file under
  `routes/**`, so a page left importing a deleted component fails the build rather than the typecheck

### Requirement: The console frontend is compiled before it reaches the trunk

Every change to `packages/console/**` SHALL be compiled by CI before merge. The SolidStart/vite build SHALL NOT run
only at deploy time, and SHALL NOT be assumed to run locally: the console does not build on Windows, which is the
primary development platform, so Linux CI is the only place a console change is compiled. This gate is what catches a
deleted component that a compiled-but-unlinked page still imports — a class of breakage invisible to typecheck, lint,
and the divergence gate.

#### Scenario: A console change opens a PR
- **WHEN** the PR touches `packages/console/**`
- **THEN** `console-build` compiles `console/app` and reports its own status check

### Requirement: Volt imports opencode's server code and replaces only its presentation

opencode colocates server queries/actions and JSX in one file. Volt SHALL import the exported server code and write
its own presentation beside it, rather than copying the server code into a Volt file. The gateway
(`routes/zen/util/**`), `stripe/webhook.ts`, `core/`, `function/`, and `mail/` SHALL stay byte-identical — they are
the backend seam Volt keeps in sync with upstream, and they carry the metering, billing, and rate-limiting the
product depends on.

#### Scenario: A Volt view needs subscription state
- **WHEN** the Gateway view renders a subscriber's usage and checkout state
- **THEN** it imports `queryLiteSubscription` and the referral queries from opencode's files, and only their markup
  is Volt's
