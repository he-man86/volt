# Design — volt-branding

## Source of truth
The **Volt Design System** Claude Design project (`7046914d-ccab-4673-aa21-f2ab8e277a29`). Pull assets/components
via the `/design-sync` workflow (DesignSync MCP). Brand rules live in its `readme.md`; do not re-derive them here.

Palette (light): bg `#F7F6F3`, surface `#EFEDE9`, hover `#E6E4DF`, border `#E0DED8`, text `#0D0D0D` / `#525252`,
accent `#D97706` (hover `#B45309`), link/focus `#C2410C`, success `#16A344`. Dark sections: `#0D0D0D` / panels
`#171717`. Type: **Inter** (UI/body) + **JetBrains Mono** (code/technical). No gradients, no emoji, restrained
motion.

---

## Decision 1 — the console reskin is a *value remap*, not a file copy

The design ships `tokens/colors.css` with Volt's **own** variable names (`--color-background`, `--color-surface`,
`--color-text-primary`, …). The console's routes read opencode's names (`--color-bg`, `--color-bg-surface`,
`--color-text`, …). **Do not overwrite `color.css` with the design file** — that renames every variable and breaks
every `var(--color-bg)` reference in the vendored routes.

Instead, keep opencode's variable **names** and rewrite their **values** to Volt's palette. Mapping:

| console token (keep name) | light value | dark value |
|---|---|---|
| `--color-bg` | `#F7F6F3` | `#0D0D0D` |
| `--color-bg-surface` | `#EFEDE9` | `#171717` |
| `--color-bg-elevated` | `#EFEDE9` | `#1C1C1F` → `#171717` |
| `--color-text` | `#0D0D0D` | `#F7F6F3` |
| `--color-text-secondary` | `#525252` | `#C7C7CC` |
| `--color-text-muted` | `#6E6E73` → `#9B968C` | keep muted-warm |
| `--color-accent` / `-hover` | `#D97706` / `#B45309` | same |
| `--color-primary*` | inherit accent (orange) | same |
| `--color-success` | `#16A344` | `#16A344` |
| `--color-border` | `#E0DED8` | `#2A2A2A` |
| link / focus | `#C2410C` | `#C2410C` |

Type: `--font-sans` → an **Inter** stack (opencode aliases sans to mono for its terminal look); `--font-mono` → a
**JetBrains Mono** stack. **Self-host** via `@fontsource-variable/{inter,jetbrains-mono}` (the repo's npm-dep
pattern; opencode vendors `@ibm/plex` the same way), not the design's Google-Fonts `@import` — the brand sells
privacy/enterprise; no third-party font CDN at runtime.

**IMPLEMENTED as an additive override, not an in-place edit** (see Decision 2 — this beats rewriting the vendored
files, and is what shipped): the value remap lives in one Volt-owned `app/src/style/volt-theme.css`, so opencode's
`token/*.css` are never touched.

## Decision 2 — the reskin is an override layer; opencode source stays byte-identical  *(RESOLVED)*

The goal (user's explicit priority): **the fewest possible changes to the vendored opencode package.** An in-place
value remap of `token/color.css`+`font.css` would modify two opencode files and re-conflict on every opencode bump.
The clean form modifies **zero** opencode source files:

- **`app/src/style/volt-theme.css`** (new, Volt-owned) re-declares the base color + font tokens with Volt values
  (light + dark) + the `@fontsource` imports. It is loaded from `app.tsx` **after** `./app.css`, so at equal
  `:root` specificity the later declaration wins; opencode's derived tokens (`--color-primary`,
  `--color-surface`, `*-text`) inherit automatically, so only base tokens are overridden.
- **opencode's `token/color.css` + `token/font.css` stay byte-identical** to upstream → they fall off the
  divergence diff and pull bugfixes conflict-free. The whole footprint is: 1 new Volt file + 1 import line in
  `app.tsx` (already divergent from the de-fork) + the 2 `@fontsource` deps in `app/package.json` (already
  divergent). **No opencode source file is freshly modified for branding.**
- **Divergence gate:** allowlist only `app/src/style/volt-theme.css`. `app/public/*` (favicons/manifests) is
  already excluded as branding Volt owns.
- **Trade-off (accepted):** because the token files are no longer diffed, an upstream **rename** of a token
  variable won't trip the gate — the app falls back to opencode's default for that one var (a visible color
  glitch), never silent data loss. Renames are rare and the break is obvious; this is preferred over carrying an
  in-place rewrite. (Supersedes the earlier "allowlist the 2 rewritten token files" plan.)
- **The marketing header is left untouched** (keeps opencode's logo) — Phase 2 replaces those routes with
  `volt-www` wholesale, so editing the header now would be churn on a soon-deleted vendored file.

## Decision 3 — where the Volt landing site lives  *(RESOLVED: Option A — a static `volt-www`)*

The user's steer: landing pages **separate** from the console; only the console page gets re-themed. Resolved in
favor of **Option A**, and specifically a **static** site — it wins on ownership *and* on the local-testing pain
(deploying to test every landing tweak is not viable; a static site runs on Windows natively).

### The routes-root reality (why "swap one folder" isn't the shape)
`console/app/routes/` is SolidStart **file-based routing** — no `marketing/` folder exists; the public pages are
~19 files/dirs scattered at the root, interleaved with the app, gateway, and API. But the **keep-set is cleanly
bounded**, so the seam is "keep the functional set, replace the rest":

| Bucket | Routes | Verdict |
|---|---|---|
| App shell + product | `workspace.tsx` (authed layout), `workspace/`, `workspace-picker`, `user-menu`, `auth/` | **keep** — vendored, token-themed |
| LLM gateway | `zen/` (incl. `zen/go/v1`) | **keep** — load-bearing product |
| Backend/API | `api/`, `stripe/webhook`, `honeycomb/webhook`, `openapi.json`, `changelog.json` | **keep** |
| opencode marketing | `index.*`, `go/`, `download/`, `enterprise/`, `bench/`, `brand/`, `changelog/`, `black.*`+`black/`, `legal/` | **replace** → volt-www |
| opencode-infra proxies/redirects | `docs/`, `data/`, `stats/`, `s/`, `t/`, `desktop-feedback`, `discord`, `feishu`, `temp` | **drop** — proxy/redirect to *opencode's* own docs/stats/discord; useless for Volt |

### Option A (chosen) — new `packages/volt-www`, **static**
Standalone Volt-owned site seeded from the design's `ui_kits/website/*`, which already ships as plain HTML/CSS — so
it needs **no SST/SolidStart SSR**: a static site (or a tiny Vite + Solid SPA).
- **+** Zero divergence pressure — the vendored console becomes purely the *app*. Matches DIVERGENCE.md's stated
  architecture ("Volt's own frontend — the real home for branding/product presentation").
- **+** **Runs on Windows** (`vite dev` / open the file) — the landing is iterable locally with no deploy, which
  directly answers the "can't test without deploying" problem. (The console's Linux-only SST build is unaffected.)
- **+** Deploys as static assets (Cloudflare Pages/R2) — cheap, independent of the console pipeline. Clean domain
  split: apex/`www` → volt-www; the console keeps its subdomain.
- **−** One-time work: a new package + a static deploy target, and deleting the ~19 opencode marketing/proxy routes
  from the console (allowlisted divergence). After that the vendored tree is *just the app* and stays clean on bumps.

### Option B (rejected) — gate-excluded route group inside `console`
Volt marketing as `app/src/routes/(www)/**`, excluded from the divergence check; opencode's marketing routes
neutralized. Rejected because it **still** requires deleting the same ~19 opencode files (URL collisions on `/`),
mixes Volt frontend into the vendored tree, **and** leaves the landing trapped in the console's Linux-only SST
build — losing the local-test benefit that motivated the split. No new deploy is its only advantage.

Either way: the landing's Sign-in **links into the console's existing OpenAuth flow** (`/auth`) — auth is not
re-implemented on the landing.

### Local-testing note (the general fix, beyond the landing)
- **Landing** → static `volt-www` → tests natively on Windows (this decision).
- **Console** (auth/app/gateway) → the SolidStart build is Linux-only, so local iteration needs **WSL** or a Linux
  dev container: `sst dev` then gives a live local console with hot reload — no deploy, no PR. The Windows box
  can't run that build; WSL on the same machine can. (Tracked as a follow-up, not part of this change.)

## Decision 4 — remove opencode's public surface from the console
With the landing living in a separate `volt-www` (Decision 3), the console no longer needs a public face at all, so
opencode's marketing routes + dead infra-proxies are **deleted** (not redirected) — see the "replace"/"drop" rows
of Decision 3's table. The console's `/` redirects to the app (workspace/auth). Rationale: once volt-www owns the
public URLs, redirect-in-place would leave ~19 opencode-branded files in the vendored tree as permanent dead
divergence; deleting them is the one-time cost that leaves the vendored tree as *just the app + gateway + API*,
which stays cleanest across opencode bumps. Record each deletion in `ALLOW` (as an `Only in opencode` divergence) +
`DIVERGENCE.md`.

(This supersedes the earlier redirect-in-place plan, which assumed marketing stayed inside the console.)

## Decision 5 — the landing's Download links to a *reliably-published* Volt installer (release pipeline)

The landing's Download CTAs are only as professional as the release they point at. So this covers both the link and
the pipeline behind it.

**What opencode does** (`sst/opencode` `publish.yml`, the workflow we follow): `workflow_dispatch`/branch trigger →
a version-bump+tag job (`script/version.ts`) → per-OS build matrix → **Windows code-signing (Azure Trusted
Signing)** + signature verification → publish to GitHub Releases, with **stable/beta channels** by branch (`dev` →
main repo, `beta` → `-beta` repo).

**What Volt does, adapted** (Volt intentionally diverges on the *updater tech* — Velopack one-installer +
connector-driven auto-update, not electron-updater; `electron-builder` is `--dir` only):
- **One Windows job, not a matrix.** Velopack ships a single `Volt-win-Setup.exe` (+ portable zip + nupkg/RELEASES
  auto-update feed); Volt's PLC tooling (bridges, CODESYS) is Windows-native, so there is no mac/linux desktop
  build to publish.
- **Tag-triggered**, per Volt's "cut releases by tagging `dev`" convention (CLAUDE.md): bump
  `packages/volt-desktop/package.json`, tag `vX.Y.Z`, push → CI builds + publishes. `.github/workflows/release.yml`
  runs `build-app.ts --upload` on `windows-latest` (bun + dotnet + `vpk`), then **verifies `Volt-win-Setup.exe`
  actually landed** on the release.
- **Root cause it fixes:** releases were cut *by hand*, so `v0.2.1` shipped with only the update feed and no
  installer (`latest/download/Volt-win-Setup.exe` 404s). Automation + the verify-asset guard make that
  unrepresentable. `build-app.ts` now passes `--token` (from `GH_TOKEN`/`GITHUB_TOKEN`) so the `vpk upload` works
  in CI without an ambient `gh` login.

**Download wiring (Decision, resolved):** volt-www links Download at the canonical
`he-man86/volt/releases/latest/download/Volt-win-Setup.exe` (env-overridable `VITE_INSTALLER_URL`) — no per-release
bump, no console resolver. A direct public GitHub-release link, so no server needed (fits the static site).

**Deferred, explicitly (professional gaps, not blockers):**
- **Code signing — PARKED (not needed).** Installer ships unsigned → SmartScreen warns on first run. opencode uses
  Azure Trusted Signing; revisit only if it becomes a problem.
- **Beta channel** — single stable channel for now; a `-beta` feed can follow opencode's branch-based split if
  pre-release testing needs it. (ponytail: not built until there's a use.)
- **Fixing the live `v0.2.1`** — re-cut through the pipeline (or `v0.2.2`) rather than a manual asset upload, so the
  first automated release also proves the pipeline. No hand-uploading.
