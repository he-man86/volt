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
- `app/package.json` — dropped the `@opencode-ai/ui` dep + the `../../opencode/script/schema.ts` build step (that package is gone).
- `app/src/ui.tsx` (new) — the two things `console/app` used from `@opencode-ai/ui` (`createSimpleContext`, `Favicon`), inlined.
- `app/src/app.tsx`, `app/src/context/i18n.tsx`, `app/src/context/language.tsx` — three import-line rewrites (`@opencode-ai/ui` → `~/ui`).

**Branding neutralization:**
- Removed opencode's `app/public/social-share*.png` and `web-app-manifest*.png`.

**Use-case edits (minimal, marked, both non-load-bearing):**
- `function/src/auth.ts` — ~17 lines: replaced opencode's hardcoded `@anoma.ly` non-prod login gate with a
  configurable `CONSOLE_DEV_EMAILS` allowlist. **Dev-only** — the gate is `stage !== "production"`, so **production
  runs opencode's original untouched.**
- `app/src/routes/workspace/[id]/index.tsx` — one `<Show when={false}>` hiding the opencode Zen banner on the
  workspace home (our product is Go). Reverts by deleting one line.

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
It runs in **`volt-ci`** on every push/PR, so an accidental edit to opencode source can't merge. `app/public/*`
(branding assets) is excluded — that's Volt's to own.

```
bun volt-scripts/check-console-divergence.ts     # local check; 0 = clean, 1 = drift
```

**On an opencode bump:** change `OPENCODE_VERSION` in the script, re-run, and reconcile `ALLOW` + this doc with the
output. Adding a new intended edit = add it to `ALLOW` **and** here (the two must agree). Anything the gate flags
that isn't intended is drift to revert.
