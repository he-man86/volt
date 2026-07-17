## Why

`packages/console/*` is vendored opencode source. Volt rebranded it by **editing that source** — 26 string edits
scattered through `i18n/en.ts`, patches to the `/go` view. The v1.17.20 → v1.18.3 bump proved the cost precisely:
upstream rewrote **`en.ts` and all 18 locale files** in three releases across four days. Every rebrand-by-patch buys
a permanent conflict on the exact files opencode touches most.

PR #34 replaced that with the shape this change generalizes: **a Volt file beside theirs, never a patch on theirs**
(`i18n/volt.ts` as an overlay; `workspace/[id]/gateway/` as a Volt view importing their sections). It worked — the
bump needed a human on only 2 of 27 changed files.

But the console is still opencode's app wearing a Volt hat, and a **50-target audit** (`console-surface-audit`,
2026-07-17: 50 classifiers + 21 adversarial refuters) says the mess isn't the patches — it's **the dead marketing
tree we agreed to keep**. `DIVERGENCE.md:61-64` keeps `routes/{enterprise, bench, brand, changelog, black.*, black,
legal, zen/index.*}` "byte-identical and dormant" because "deleting them buys nothing". That reasoning has now
failed four times:

- **`/go` was never dormant** — it is the referral landing page (`go-referral` emits `/go?ref=CODE`). Invitees met
  an "OpenCode Go" page linking our deleted `/docs`. Fixed in #34.
- **`/download` was never a page** — its `[channel]/[platform].ts` proxied opencode-desktop binaries from
  `github.com/anomalyco/opencode` off Volt's domain. Dropped in #34.
- **`bench/submission.ts` is an unauthenticated public POST** (`:14-31`) writing straight into the production
  `BenchmarkTable` with no actor/API-key check, unlike every sibling route. Unlinked ≠ unexposed.
- **`/black/subscribe/[plan].tsx` is entered by an auth redirect** (`:33`), not an href — which is why "nothing
  links to /black" scans miss it — and its stage gate is **inverted** (`:22-25`): the checkout is live precisely on
  `dev.volt-ai.dev`, not production.

Dormancy was asserted, never tested. The dead tree is also why `en.ts` is 700 lines of opencode product copy, why
`generate-sitemap.ts` ships **90 `https://opencode.ai/*` URLs** into a gitignored `sitemap.xml` on every build, and
why every question about this package starts with "wait, is that page live?"

## What changes

**The standing rule becomes explicit:** never edit vendored opencode source. Volt customization lives in Volt-owned
files beside it, with a closed, documented list of irreducible exceptions. The audit puts that floor at **6 files**
— `app.tsx`, `entry-server.tsx`, `ui.tsx`, `vite.config.ts`, `middleware.ts`, `routes/auth/logout.ts` — all
filename-bound framework entry points that cannot be shadowed by a beside-file.

**The dormant-marketing policy is reversed:** the console serves *no* marketing. `volt-www` owns the public face.
Everything opencode-marketing gets deleted and declared in `DROPPED`, which never conflicts on a bump.

**The seam is drawn where the audit found it** — not frontend/backend, but *their server code vs their JSX*.
Opencode colocates both in one file (`lite-section.tsx` exports `queryLiteSubscription` **and** its markup). Volt
**imports the queries and replaces the JSX**, exactly as `gateway/index.tsx:5` already does.

## Constraints this must respect (all found by the audit)

- **Deletes cannot be piecemeal.** SolidStart compiles every file under `routes/**`; `vite.config.ts` applies no
  route filter. `faq.tsx` has 2 live importers, `footer` 6, `header` 6, `legal` 6, `locale-links` 7, `config.ts` 6+.
  Deleting any one alone **breaks `vite build`**. The sweep is one atomic change: pages **and** their exclusive
  components together.
- **`console-build.yml` is the only gate that catches it.** The console does not build on Windows (a `vite:define`
  bug mangles Windows paths), so Linux CI is the sole place this is ever compiled. Added in #34 — this change
  depends on it.
- **`black.tsx` is a layout, not a page** (`:13` renders `props.children` for four `/black/*` routes).
- **`brand/index.css` is the legal pages' stylesheet** — `:11-12` scopes `[data-page="legal"]`, imported by both
  legal pages, which define no tokens of their own. Deleting it **silently unstyles them with a green build**.
- **Overlays must merge at the shared factory.** `i18n/volt.ts` merged into `context/i18n.tsx` was client/SSR-only:
  six server call sites build the dict straight from `i18n()`, so the gateway handler shipped "OpenCode Go" to a
  paying user's CLI while typechecking, building, and rendering correctly. Fixed + pinned by `volt.test.ts`.

## Stages

**Stage 0 — live bugs (independent, ship first).** These are broken in production today and are not blocked by any
of the below:
1. `function/src/log-processor.ts:13-20` allowlists only `/zen/v1/*`; Volt's gateway is `/v1/*` — **all live Volt
   gateway traffic is silently dropped from Honeycomb**.
2. `app.tsx:18` renders `app.meta.description` = *"OpenCode - The open source coding agent."* as the meta
   description of **every authed page**.
3. `zen/util/handler.ts:878,949-950` hardcode `https://opencode.ai/workspace/${id}/...` into user-facing gateway
   errors — Volt's API telling Volt's paying users to go to opencode's console.
4. `bench/submission.ts` — unauthenticated public write endpoint (closed by Stage 2's delete; call out separately
   because it is a live exposure, not cleanup).

**Stage 1 — port `volt-www`'s tokens (cheapest, highest payoff, zero page edits).** The console already routes every
brand-able value through CSS custom properties, so re-declaring `volt-www/src/tokens/{colors,spacing,typography}.css`
values inside `style/volt-theme.css` reskins the whole authed app to match the landing page **without touching one
page**. Note: `volt-www` is **React**, the console is **SolidJS** — components cannot be shared, only tokens/CSS.

**Stage 2 — the atomic marketing sweep.** Delete `routes/{enterprise, bench, brand, changelog, changelog.json.ts,
legal, black, black.tsx, black.css, zen/index.*, openapi.json.ts}` **plus** their now-exclusive components
(`header, footer, faq, legal, locale-links, language-picker, email-signup, spotlight`), `config.ts`, and
`script/generate-sitemap.ts`; rewrite `DIVERGENCE.md`'s dormant-marketing policy; declare it all in `DROPPED`.
Before deleting `brand/index.css`, move the `[data-page="legal"]` tokens it owns (or delete the legal pages with it).
**Windows build — predicted, then disproved (kept as a caution):** `black/subscribe/[plan].tsx` was expected to be
the *only* reason the console can't build on Windows, so dropping the Black tree was expected to bring local builds
back. It did not. With that file gone its `vite:define` error is indeed gone — but a *second* Windows path bug
surfaces underneath (`Rollup failed to resolve import "C:UsersmarceGithubolt…"`, the `\v` in `…\volt` eaten as a
vertical-tab escape). **The console still builds on Linux only**, so `console-build` on CI remains the single place
a console change is compiled before it reaches `dev`. Recorded here so the prediction isn't re-attempted.

**Stage 3 — own the authed chrome** (`VOLT_OWN`): `[...404].tsx` (today it links `/docs` and `/discord`, both
deleted — the 404 page 404s), `workspace.tsx` (opencode wordmark on every authed page), `user-menu.tsx`.

**Stage 4 — views, one at a time, importing their queries** (`IMPORT_QUERY`): `usage` and `settings` first (small,
table-shaped), `members` and `go/index.tsx` next, **`billing` last or never** — it is 11 Stripe/Drizzle server
actions and rewriting its JSX means owning that surface's bugs.

## Non-goals

- Rewriting `lite-section.tsx`'s subscription/checkout logic or `usage`'s cost math. Import it.
- Touching the gateway (`zen/util/**`, 4139 lines), `stripe/webhook.ts`, `core/`, `function/`, `mail/`. This is the
  backend seam and it stays byte-identical — that is the whole point of staying in sync.
- Sharing components with `volt-www`. Different framework; only tokens port.
- Deleting `routes/api/support/*` (the console's only `Account.remove` path). `api/enterprise.ts` is a carve-out:
  it forwards prospect PII to `contact@anoma.ly`, EmailOctopus, and opencode's Salesforce, and its only caller is
  the deleted `/enterprise` page — it goes with Stage 2.

## Risks

- **A missed importer turns the sweep red at `console-build`, not at typecheck.** That is the designed outcome; the
  gate exists for exactly this. Expect iteration.
- **The refuters were enforcing the current written policy.** 15 of 17 deletes were refuted partly *because*
  `DIVERGENCE.md` says keep them — this change rewrites that policy, so those refutals resolve by decision, not by
  argument. The compile-time refutals are real engineering constraints and do not.
- **The audit is not infallible**: its own `bench` and `changelog.json.ts` passes asserted "no sitemap exists" when
  three sitemap files do; the conclusions survived by luck. Re-check reachability before each delete rather than
  trusting the table.
