# Vendored-console divergence audit (vs opencode `v1.17.20`)

**Policy (standing rule).** `packages/console/*` is vendored opencode source, pinned at **`v1.17.20`**, kept as close
to upstream as possible so we can pull opencode's bugfixes with minimal friction. Volt's customization lives in
layers opencode doesn't own:

| Layer | Owner | Customize here? |
|---|---|---|
| **config / infra** | Volt | ✅ yes — `infra/*`, `models.json`, `ZEN_LIMITS`, Stripe prices, `deploy.yml`, `volt-config/*` |
| **opencode source** (`packages/console/*`) | opencode | ❌ minimize — only unavoidable de-fork glue + tiny, marked use-case edits |
| **Volt's own frontend** (future) | Volt | ✅ yes — the real home for branding / product presentation |

Product decisions (Go-only, €24, 50% margin, which models) are **config**, never edits to opencode routes.
Every source edit is tagged with a `VOLT:` comment so it's obvious on merge.

## Audit (2026-07-15, diffed against the v1.17.20 tarball, CRLF-normalized)

Only these differ in `packages/console/*` — everything else is byte-identical to opencode:

**De-fork necessities** (the `@opencode-ai/ui` + `opencode` packages were deleted in the de-fork):
- `app/package.json` — dropped the `@opencode-ai/ui` dep + the `../../opencode/script/schema.ts` build step (that
  package is gone); added `@fontsource-variable/{inter,jetbrains-mono}` for the self-hosted Volt brand type (below).
- `app/src/ui.tsx` (new) — the two things `console/app` used from `@opencode-ai/ui` (`createSimpleContext`, `Favicon`), inlined.
- `app/src/app.tsx` — the `@opencode-ai/ui` → `~/ui` import rewrite, **plus one line**: `import
  "./style/volt-theme.css"` (the brand override, after `./app.css`). `app/src/context/i18n.tsx`,
  `app/src/context/language.tsx` — import-line rewrites.

**Branding reskin (volt-branding Phase 1) — an ADDITIVE override, zero edits to opencode source.** The console
consumes every brand-able value through a CSS custom-property token layer, so the whole authenticated app reskins
from **one Volt-owned file**:
- `app/src/style/volt-theme.css` (new, Volt-owned) — re-declares the base color + font tokens with Volt's values
  (light + dark), self-hosting Inter/JetBrains via `@fontsource` (no CDN). Loaded from `app.tsx` **after**
  `./app.css`, so it wins at equal `:root` specificity; opencode's derived tokens (`--color-primary`, `--color-surface`,
  the `*-text` vars) inherit automatically.
- **opencode's own `app/src/style/token/*.css` stay BYTE-IDENTICAL** to upstream — the reskin adds no edit to any
  opencode source file, so those tokens pull opencode's bugfixes with zero merge conflict. The only footprint is
  the one new Volt file + one `app.tsx` import line (already a divergent file) + the two `@fontsource` deps in
  `app/package.json` (already divergent).
- Trade-off: because the token files aren't in the divergence diff, an upstream token **rename** shows opencode's
  default for that var (a visible glitch) instead of tripping the gate — preferred over rewriting vendored files
  (renames are rare, the break is obvious). See `volt-branding/design.md` Decision 2.
- The (marketing-only) header keeps opencode's logo for now — it is **not** touched. Phase 2 replaces the marketing
  routes with `volt-www` wholesale, so branding that header would be churn on a soon-deleted vendored file.

**Branding neutralization:**
- Removed opencode's `app/public/social-share*.png` and `web-app-manifest*.png`.

**Public-surface strip (volt-branding Phase 2)** — the console is now **app-only**; the public site is `volt-www`
(separate, Volt-owned). Deliberately a **hybrid** to touch opencode as little as possible:
- **Kept BYTE-IDENTICAL + dormant** — opencode's marketing PAGES (`routes/{go, download, enterprise, bench, brand,
  changelog, black.*, black, legal, zen/index.*}`). They only render; they're unlinked and off the public face
  (volt-www owns it), so deleting them buys nothing and would just add divergence. Left pristine, they fall off the
  gate entirely and pull opencode bugfixes conflict-free. (`changelog.json.ts` API + gateway `zen/{go,util,v1}`:
  also kept.)
- **Deleted** — only the active PROXY/REDIRECT routes that *serve or redirect to opencode's own infra*:
  `routes/{docs, data, stats, s, t, desktop-feedback.ts, discord.ts, feishu.ts}` (+ opencode's `index.*` landing).
  These DO something wrong for Volt (serve opencode docs/binaries, redirect to opencode's Discord), so they go.
  Encoded as the gate's `DROPPED` prefix list (a dir or any file under it) so the deletions don't balloon `ALLOW`.
- **Added** `routes/index.ts` (Volt, in `ALLOW`) — `/` → `redirect("/auth")` (the console home is the app, not
  opencode's landing).
- **`component/legal.tsx`** (marked edit, in `ALLOW`; it renders in the AUTHED shell, so it had to change) —
  opencode's footer said "© Anomaly", linked opencode's `/brand` kit, and linked opencode's ToS/Privacy **whose
  text binds users to ANOMALY INNOVATIONS, INC.** (legally wrong for Volt). Stripped to "© Volt" + the language
  picker. **Volt's own ToS/Privacy are a follow-up: authored by Volt, hosted on `volt-www`, linked here
  cross-site** — do NOT reuse opencode's legal text (which is why opencode's `legal/` is left dormant, not adopted).
- `config.ts` (opencode.ai/anomalyco) is imported by **no** kept route after the strip → dormant, left pristine.

**Use-case edits (minimal, marked, both non-load-bearing):**
- `function/src/auth.ts` — ~17 lines: replaced opencode's hardcoded `@anoma.ly` non-prod login gate with a
  configurable `CONSOLE_DEV_EMAILS` allowlist. **Dev-only** — the gate is `stage !== "production"`, so **production
  runs opencode's original untouched.**
- `app/src/routes/workspace/[id]/index.tsx` — the Zen landing (opencode's PAYG model catalog + BYOK-gateway
  `ProviderSection`) is retired; the index now `<Navigate>`s to Go, which becomes the workspace home. Volt sells one
  product (Go); we don't resell the gateway/BYOK. **Top-up/balance is untouched** — it lives on the Billing tab.
- `app/src/routes/workspace/[id].tsx` — the "Zen" nav tab is wrapped in `<Show when={false}>` (both the desktop and
  mobile nav). Reverts by deleting the two `Show`s.

**Volt-only (not opencode source):** `VENDORED.md` (provenance).

**Explicitly reverted to opencode-original** (do NOT re-introduce): `app/src/middleware.ts` (a route-redirect
experiment) and `app/src/routes/zen/v1/models.ts` (debug logging) — both confirmed byte-identical again. And
`app/public/email/` (a directory of email assets that a vendoring glitch had flattened to a stray file) — restored.

## The Go product is 100% config, zero source divergence
The switch to a single Go product is expressed entirely in config: `volt-config/opencode.json` points the agent at
`/zen/go/v1` (the Go/`lite` endpoint, `modelList: "lite"`); `models.json` populates `liteModels`; `ZEN_LIMITS.lite`
sets the caps; the Go Stripe price is €24. opencode's Zen/Black routes stay pristine (unlinked, dormant).

## Enforced automatically — the symmetry gate
`volt-scripts/check-console-divergence.ts` diffs `packages/console/*` against the pinned opencode tag and **exits
non-zero if any SOURCE file diverges outside the allowlist** (the list above, encoded as `ALLOW` in the script).
It runs as the dedicated **`.github/workflows/console-symmetry.yml`** workflow — **path-filtered** to fire only
when `packages/console/**` or the check script changes (the only time drift can appear), so unrelated pushes don't
pay the opencode download. An accidental edit to opencode source can't merge. `app/public/*` (branding assets) is
excluded — that's Volt's to own.

```
bun volt-scripts/check-console-divergence.ts     # local check; 0 = clean, 1 = drift
```

**On an opencode bump:** change `OPENCODE_VERSION` in the script, re-run, and reconcile `ALLOW` + this doc with the
output. Adding a new intended edit = add it to `ALLOW` **and** here (the two must agree). Anything the gate flags
that isn't intended is drift to revert.
