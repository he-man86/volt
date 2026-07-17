Make the vendored console Volt's app without patching opencode's source. Grounded in the `console-surface-audit`
(2026-07-17, 50 classifiers + 21 adversarial refuters); see `proposal.md` for the verdicts and the traps.

**Ground rule for every task below:** never edit a vendored file. Add a Volt file beside it, delete it and declare
it in `DROPPED`, or import from it. The only exceptions are the 6 irreducible entry points in Stage 5.

## Stage 0 — live bugs (independent of everything else; ship first)
- [ ] **Honeycomb is blind to Volt's gateway.** `function/src/log-processor.ts:13-20` allowlists only `/zen/v1/*`
      and `/zen/go/v1/*`; Volt's real path is `/v1/*` (`volt-config/opencode.json:14` → `https://volt-ai.dev/v1`).
      All live Volt gateway traffic is dropped from observability. The `routes/v1/*` beside-file was added without
      repointing the processor — fix the allowlist, then confirm a real request appears in Honeycomb.
- [ ] **Every authed page's meta description says "OpenCode".** `app.tsx:18` renders `app.meta.description`
      (`en.ts:84`). `app.tsx:17` fixed the `<Title>` and missed this. Cheapest fix: an `app.meta.description`
      override in `i18n/volt.ts` (no new divergence — the overlay already exists and now merges at the factory).
- [ ] **Volt's API sends Volt users to opencode's console.** `zen/util/handler.ts:878,949-950` hardcode
      `https://opencode.ai/workspace/${id}/{billing,members,go}` and interpolate them into user-facing errors
      (`:952-953, :981-986, :893-933`). Same class as the `trialEnded` bug fixed in #34. Not overlay-fixable — these
      are string literals, not dict keys; needs a marked edit or an upstream-configurable value.
- [ ] **`handler.ts:93` hardcodes opencode's own workspace ID** (`// anomaly`) into an allowlist running in Volt's
      deployed gateway. Decide: keep (harmless inert row) or remove (a marked edit).
- [ ] Re-run `bun volt-scripts/check-console-divergence.ts` — any of the above that edits vendored source must land
      in `ALLOW` **and** `DIVERGENCE.md`.

## Stage 1 — port volt-www's design tokens (zero page edits)
- [ ] Map `packages/volt-www/src/tokens/{colors,spacing,typography}.css` onto the token names the console consumes;
      re-declare the values in `packages/console/app/src/style/volt-theme.css` (already `ALLOW`-ed, already the
      single branding source). **Do not** touch `style/token/*.css`.
- [ ] Confirm the reskin needs no page edits — the console routes brand-able values through custom properties.
      If a value cannot be reached from the token layer, record which file blocks it rather than patching that file.
- [ ] Note for whoever picks this up: `volt-www` is **React**, the console is **SolidJS**. Components cannot be
      shared — only tokens/CSS port.
- [ ] Verify visually (Linux/CI build or a deployed stage — the console does not build on Windows).

## Stage 2 — the atomic marketing sweep (ONE change; piecemeal deletes break the build)
- [ ] **Decide the policy first**: rewrite `DIVERGENCE.md:56-64`'s "kept BYTE-IDENTICAL + dormant" rule. Dormancy
      was asserted and disproved four times (`/go`, `/download`, `bench/submission.ts`, `/black/subscribe`). New
      rule: the console serves no marketing; `volt-www` owns the public face; unreachable ≠ unexposed.
- [ ] Delete routes: `enterprise`, `bench`, `brand`, `changelog`, `changelog.json.ts`, `legal`, `black/` (subtree),
      `black.tsx` + `black.css`, `zen/index.tsx` + `index.css`, `openapi.json.ts`.
- [ ] Delete their now-exclusive components **in the same change** (each has live importers *only* inside the set
      above; deleting either half alone fails `vite build`): `header.tsx`, `footer.tsx`, `faq.tsx`, `legal.tsx`,
      `locale-links.tsx`, `language-picker.tsx` (+ `.css`), `email-signup.tsx`, `spotlight.tsx` (+ `.css`),
      `config.ts`, `script/generate-sitemap.ts` (and drop its `&&`-chain from `app/package.json:10`).
- [ ] **Trap — `brand/index.css` is the legal pages' stylesheet**, not brand assets: `:11-12` scopes its token block
      to `[data-page="enterprise"], [data-page="legal"]`, and both legal pages import it while defining no tokens
      themselves. Deleting it unstyles them **with a green typecheck and a green build**. It leaves with the legal
      pages or not at all.
- [ ] **Trap — `black.tsx` is the layout** for `black/{index,workspace,common,subscribe/[plan]}.tsx` (`:13`
      renders `props.children`); `black.css` defines the `[data-page="black"]` base that `black/workspace.css:1` and
      `language-picker.css:91-133` extend. The subtree leaves together.
- [ ] Closes `bench/submission.ts` (the unauthenticated public POST) and `api/enterprise.ts` (Volt-hosted form
      forwarding prospect PII to `contact@anoma.ly` + EmailOctopus + opencode's Salesforce; its only caller is the
      deleted `/enterprise` page).
- [ ] Declare every deletion in `DROPPED` (`volt-scripts/check-console-divergence.ts`) and reconcile
      `DIVERGENCE.md`. `DROPPED` entries never conflict on a bump — that is the point.
- [ ] **Verify, don't assume:** `black/subscribe/[plan].tsx` is the file whose `vite:define` bug breaks the Windows
      build. If the Black tree going restores local `bun run build` on Windows, say so in `DIVERGENCE.md` and in
      `commercial-cloud-backend/tasks.md`, which currently records "console/app builds only on Linux" as a fact.
- [ ] Gate: `console-build` (catches missed importers), `console-symmetry` (catches undeclared deletes), typecheck.

## Stage 3 — own the authed chrome (`VOLT_OWN`)
- [ ] `routes/[...404].tsx` + `.css` — the app's only catch-all: opencode wordmark, `"Not Found | opencode"` title,
      an `anomalyco/opencode` link, and links to `/docs` (`:30`) + `/discord` (`:36`), **both already deleted** — the
      404 page 404s onto itself.
- [ ] `routes/workspace.tsx` + `.css` — the authed shell on every page; renders `IconWorkspaceLogo` (the opencode
      mark) and is the last i18n foothold in the authed app.
- [ ] `routes/user-menu.tsx` + `.css` — authed header chrome; carries a dead duplicate `_logout` `"use server"`
      action. NB: despite living in `routes/`, this and `workspace-picker.tsx` / `workspace/common.tsx` have **no
      default export** — they are components, not routes. A "delete the dead routes" sweep would kill live chrome.

## Stage 4 — views, one at a time, importing their server code (`IMPORT_QUERY`)
- [ ] `usage` — import `getCosts` (~75 lines of hand-written drizzle); its legend hardcodes `" (go)"`.
- [ ] `settings` — 231 lines, two console-core server bindings behind a one-field form.
- [ ] `members` — four console-core `User.*` mutations; dormant-by-nav but URL-reachable and named in gateway error
      text. Decide whether Volt offers team invites at all before writing a Volt view for it.
- [ ] `go/index.tsx` — now a dormant duplicate of Volt's Gateway; `lite-section.tsx` is already imported by
      `gateway/index.tsx:5`. Fold what remains into `gateway/`.
- [ ] `component/go-referral.tsx` — its three `Referral.*` server fns are already exported and imported; only the
      JSX needs a Volt version. Its invite link is `/go?ref=` → keep working with `routes/go/index.ts`.
- [ ] **`billing` last or never** — 11 Stripe/Drizzle server actions; its JSX carries "OpenCode Black" +
      `help@anoma.ly`. Rewriting it means owning Stripe checkout bugs. The i18n overlay already covers its strings.

## Stage 5 — write the floor down
- [ ] Document the closed set of irreducible edits in `DIVERGENCE.md`, one line of justification each. Per the
      audit these are the only files that cannot be shadowed by a beside-file:
      `app.tsx` (filename-bound root), `entry-server.tsx` (filename-bound SSR entry), `ui.tsx` (hand-inlined from a
      deleted package — nothing to sit beside), `vite.config.ts` (vite resolves this exact filename), `middleware.ts`
      (single global slot pinned at `vite.config.ts:8`; the sole `?ref=` capture point), `routes/auth/logout.ts`
      (SolidStart maps path→URL, so it cannot be shadowed).
- [ ] Add the rule to `CLAUDE.md`: vendored console = never edit; add beside, delete + declare, or import.
- [ ] Re-run the audit after Stage 2 to confirm the surface actually shrank and no new reachability appeared.
