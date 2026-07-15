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
- `app/src/app.tsx` — the `@opencode-ai/ui` → `~/ui` import rewrite; the `import "./style/volt-theme.css"` brand
  override (after `./app.css`); and the authed-app `<Title>` `"opencode"` → `"Volt"` (browser tab).
  `app/src/context/i18n.tsx`, `app/src/context/language.tsx` — import-line rewrites.

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
  `routes/{docs, data, stats, s, t, desktop-feedback.ts, discord.ts, feishu.ts}` (+ opencode's `index.*` landing and
  `temp.tsx` — a scratch home mockup that imported the deleted root `index.css`, so it couldn't be kept pristine).
  These DO something wrong for Volt (serve opencode docs/binaries, redirect to opencode's Discord), so they go.
  Encoded as the gate's `DROPPED` prefix list (a dir or any file under it) so the deletions don't balloon `ALLOW`.
- **Added** `routes/index.ts` (Volt, in `ALLOW`) — `/` → `redirect("/auth")` (the console home is the app, not
  opencode's landing).
- **Edited** `routes/auth/logout.ts` (in `ALLOW`) — one line: `redirect("/zen")` → `redirect("/auth")`. opencode
  sent logged-out users to its `/zen` marketing page (opencode branding + a page Volt doesn't serve publicly); the
  app-only console returns them to the login screen.
- **Legal footer removed from the authed shell** — `routes/workspace/[id].tsx` no longer renders opencode's
  `<Legal>` (which showed "© Anomaly" + opencode's `/brand` and ToS/Privacy links, whose text binds users to
  ANOMALY INNOVATIONS, INC.). Volt's legal lives on the public site (`volt-www`), not the account console, so the
  console footer just drops it. `component/legal.tsx` is therefore left **pristine + unused** (off the gate) — not
  edited. NB: the footer language picker went with it (it was only rendered inside `<Legal>`); the console is
  account-management and locale still resolves from cookie/browser, so this is acceptable.
- `config.ts` (opencode.ai/anomalyco) is imported by **no** kept route after the strip → dormant, left pristine.

**Logged-in-surface branding sweep (volt-branding Phase 3)** — the strings/links a signed-in user or API client
actually sees, found via a full audit of the active workspace surface:
- **Edited** `i18n/en.ts` (in `ALLOW`) — the vendored views are English-only in practice; user-visible strings
  rebranded: opencode's **"Go"** lite tier → **"Volt Gateway"**, `opencode` → `Volt` across `workspace.lite.*`,
  `workspace.keys.*`, `workspace.usage.*`. The **"Black"** (premium) tier is left **pristine opencode** — Volt
  doesn't sell it, so those strings never render and stay byte-identical.
- **Edited** `routes/workspace/[id].tsx` — tab label `Go` → `Gateway`; **Members tab removed** from the nav
  (team invites not offered yet; `/members` route stays dormant); dropped the shell's own `<main data-page=
  "workspace">` wrapper (the parent `routes/workspace.tsx` already provides it — removes a nested `<main>`).
- **Edited** `routes/workspace/[id]/go/index.tsx` + `go/lite-section.tsx` — dropped two "Learn more" links to
  opencode's deleted `/docs` (`/docs/go`, `/docs/#opencode-go`, both 404); removed the now-unused `useLanguage`.
- **Deleted** `routes/workspace/[id]/{new-user,model,provider}-section.tsx` (+ `.module.css`) — orphaned Zen-landing
  sections (imported by nothing after the workspace-home → `/go` redirect), which still held opencode strings.
  In `DROPPED`.
- **Edited** `routes/zen/util/modelsHandler.ts` (in `ALLOW`) — `/v1/models` (and `/zen/go/v1/models`) returned
  `owned_by: "opencode"` for every model → `"volt"` (visible to any API client).
- **Edited** the team-invite email — `core/src/aws.ts` (sender `OpenCode Zen <contact@anoma.ly>` →
  `Volt <noreply@volt-ai.dev>`), `core/src/user.ts` (subject + `assetsUrl`), `mail/…/InviteEmail.tsx` (opencode.ai
  URLs + "OpenCode" copy → Volt). **Dormant** (Members UI disabled) and needs a verified `volt-ai.dev` SES sender
  identity + `/email` asset hosting before it can actually deliver — rebranded now so it's correct when reactivated.
- **Not changed:** `volt-config/opencode.json` `baseURL` stays `https://volt-ai.dev/v1` (production) — the correct
  shipped end-state; the agent gateway goes live when the production stage deploys (not a code fix).

**Use-case edits (minimal, marked, both non-load-bearing):**
- `function/src/auth.ts` — (a) replaced opencode's hardcoded `@anoma.ly` non-prod login gate with a configurable
  `CONSOLE_DEV_EMAILS` allowlist (**dev-only**; `stage !== "production"`, so production runs opencode's original);
  (b) **PUBLIC branding** — the OpenAuth login page (the UI every user sees at `auth.${domain}`) now uses the Volt
  mark (self-contained data URI) + `title: "Volt"` + orange `primary`, replacing opencode's `favicon-v3.svg`;
  (c) the GitHub email-fetch `User-Agent` `"opencode"` → `"volt"`.
- `app/src/routes/v1/*` (new, Volt-owned) — the **clean public gateway path**: `/v1/{chat/completions, messages,
  models}` (the OpenAI/Anthropic convention), so a subscriber's `baseURL` is `volt-ai.dev/v1` with no opencode
  `zen/go` in the URL. Each re-runs the same thin config as the vendored `zen/go/v1` handler (kept intact; the
  handler keys off the request body, not the path). `volt-config/opencode.json` points the agent at `/v1`.
  Independent of the console domain — deploys at the apex with the console.
- `app/src/routes/workspace/[id]/index.tsx` — the Zen landing (opencode's PAYG model catalog + BYOK-gateway
  `ProviderSection`) is retired; the index now `<Navigate>`s to Go, which becomes the workspace home. Volt sells one
  product (Go); we don't resell the gateway/BYOK. **Top-up/balance is untouched** — it lives on the Billing tab.
- `app/src/routes/workspace/[id].tsx` — **Volt-owned workspace shell.** Rewritten from opencode's layout route so
  Volt owns the nav/tabs/chrome (its restyle surface), while the view routes (`billing`/`keys`/`members`/`settings`/
  `usage`/`go`) stay 100% vendored, rendered as `props.children`. Drops opencode's Zen product (Volt sells Go), the
  i18n/language-switch layer (unused), and the `<Legal>` footer — no `<Show when={false}>` hacks. Keeps opencode's
  `data-component` structure so the token-themed `[id].css` applies. Only backend touch: `querySessionInfo` (isAdmin).
  Trade-off: no longer pulls opencode's *shell-layout* changes (the views still do); the shell is trivial + stable.

**Volt-only files:** none — this doc + `check-console-divergence.ts` are the provenance record (the old
`packages/console/VENDORED.md` was removed to keep the vendored tree byte-clean vs. opencode).

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
