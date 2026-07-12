# Design — minimize the opencode fork

> Visual of the end-state desktop (branded shell over pristine opencode + connector-hosted IDE panel):
> **`mockup.html`** (in this change dir) — open in a browser.

## Principle
> Volt owns the **surface** (brand, the desktop shell, the config bundle, the connector + its IDE panel) and
> reuses opencode's **core AND GUI** unchanged. Every capability is additive; the only upstream edits left are a
> thin, near-static **branded desktop shell**. No edits to `packages/app`, `packages/ui`, or `packages/opencode/src`.

## Seam-by-seam fate (the 18 live seams → ~9)

Legend: **DELETE** = revert to pristine · **SHRINK** = keep file, remove part · **KEEP** = deliberate shell/dev seam.

| # | Seam (upstream file) | Fate | How / why |
|---|---|---|---|
| 1 | `bun.lock` | KEEP | workspace deps for `volt-*` (regenerated) — unavoidable, static |
| 2 | `.husky/pre-push` | KEEP | dev-only typecheck scope, static |
| 3 | `.gitignore` | KEEP | `/memory` junction, static |
| 4 | `.opencode/tui.json` | KEEP | selects the Volt TUI theme, static (config, not code) |
| 5 | `packages/ui/.../logo.tsx` | **KEEP\*** | the ONE optional in-GUI branding seam. Static (logo ≠ layout). Drop it if you accept opencode's logo inside the view; keep it for in-GUI Volt identity. |
| 6 | `packages/desktop/src/main/index.ts` | SHRINK | keep app-name + sidecar env (`OPENCODE_CONFIG_DIR`/PATH, `OPENCODE_DISABLE_AUTOUPDATE`); **drop** the `window.volt` panel-IPC wiring |
| 7 | `packages/desktop/electron-builder.config.ts` | KEEP | productName/appId/installer/icon/updater-feed/extraResources — the Volt shell/installer |
| 8 | `packages/desktop/src/renderer/index.html` | KEEP | window title (shell chrome) |
| 9 | `packages/app/index.html` | **DELETE** | shell sets the OS window title; accept opencode's web `<title>` |
| 10 | **`packages/app/src/pages/session.tsx`** | **DELETE** | the `<VoltIdePanel/>` mount → panel moves to the **connector**. *The churniest seam.* |
| 11 | `packages/app/package.json` | **DELETE** | `@opencode-ai/volt-app` dep unused once the panel is gone |
| 12 | `packages/app/.../deep-links.ts` | **DELETE** | shell translates `volt://`→`opencode://` before handing the link to the pristine app |
| 13 | `packages/desktop/src/preload/index.ts` | **DELETE\*** | `window.volt` existed for the panel; the connector owns the panel now (verify no other consumer) |
| 14 | `packages/desktop/electron.vite.config.ts` | SHRINK | keep sidecar bundling; **drop** the channel default (→ build-env `OPENCODE_CHANNEL=prod`) |
| 15 | `packages/desktop/package.json` | SHRINK | keep `volt-git` (sidecar); **drop** `volt-control` (panel IPC gone) |
| 16 | `packages/app/vite.js` | **DELETE** | pristine `vite.js` already reads `process.env.OPENCODE_CHANNEL`; set `=prod` in the desktop build env → same result, no source edit |
| 17 | `packages/opencode/src/installation/index.ts` | **DELETE** | no in-binary self-updater feed: the whole bundle updates via our installer/electron-updater (aligns with `consolidate-app-runtime`) |
| 18 | `packages/opencode/src/cli/cmd/tui.ts` | **DELETE** | set `OPENCODE_CONFIG_DIR`/PATH **before** launching opencode (env-wrapper) so Bun's worker-env snapshot already carries them |

**Result:** 6 `packages/app` + 1 `packages/ui` + 2 `packages/opencode/src` edits **gone**. Surviving surface:
`bun.lock`, `.husky/pre-push`, `.gitignore`, `.opencode/tui.json`, `logo.tsx*`, and the 4 desktop-shell files
(`main/index.ts`, `electron-builder.config.ts`, `renderer/index.html`, `electron.vite.config.ts`) +
`desktop/package.json`. **All near-static; none ride opencode's GUI/core churn.**

## End-state architecture
```
Volt install (our NSIS)
 ├─ stock opencode (pinned release, unmodified) ── serves backend + GUI over HTTP (`opencode web` → localhost)
 ├─ OPENCODE_CONFIG_DIR bundle ── LSP registration + volt tool + agent + theme + permissions   (additive)
 ├─ env-wrapper `volt` ── sets OPENCODE_CONFIG_DIR/PATH before exec (kills the tui.ts seam)
 ├─ desktop shell (Volt-owned Electron) ── spawns opencode, LOADS its SERVED GUI url in a BrowserView,
 │                                          draws Volt chrome (titlebar/brand/"IDE changes" button) around it
 └─ connector (volt-*) ── bridge gateway + IDE-changes panel + runs volt-git for pull/push
```

**The desktop WRAPS opencode's served GUI — it does NOT bundle `packages/app`.** `opencode web` (verified:
`cli/cmd/web.ts` → `Server.listen`) serves the GUI at `http://localhost:<port>`; the Volt shell loads that URL
in a BrowserView. So the desktop needs **no `@opencode-ai/app` package, no GUI vendoring, no GUI seams** — the
GUI is consumed as a running URL exactly like the backend is consumed as a running process. Pristine GUI is
enforced *by construction* (you can't edit a page you load by URL). This is also what makes a **clean standalone
`volt` repo** viable: `volt-*` packages + config + a thin shell, depending on opencode only as a **runtime**
(chained install) + `@opencode-ai/plugin`. No monorepo fork. (Extracting that repo is a follow-on, sequenced
after this de-fork lands.)

## `check-divergence.ts` simplification (tighten while shrinking)
- Shrink `ALLOWED_MODIFICATIONS` from 18 → the ~9 survivors. Every removed entry means a *re-introduced* edit to
  `packages/app`/`ui`/`opencode/src` now trips as a **violation** — the guard enforces the discipline.
- Add self-test cases (mirroring the existing "retired Volt-tab files are no longer seams" case) asserting each
  removed seam is now a violation: `session.tsx`, `app/package.json`, `app/index.html`, `deep-links.ts`,
  `app/vite.js`, `cli/cmd/tui.ts`, `installation/index.ts`, `preload/index.ts`.
- The classifier logic itself is unchanged — only the allowlist data shrinks. Simpler surface, stronger invariant.

## Edge cases (the ones that will bite if unplanned)
1. **The IDE-changes view is a desktop FRONTEND — NOT a bridge-connector change.** It is the desktop sibling of
   the VS Code extension: a thin UI over `@opencode-ai/volt-control` (the exact layer the extension uses —
   `readBridgePort` / `probeHealth` / `fetchStatus` / `subscribeChanges` / `pull` / `push`). Like the extension,
   it **knows its own workspace** (the desktop's active project) and resolves the bridge via the **forward**
   binding `readBridgePort(workspaceRoot)` — so there is **no reverse lookup and no bridge-connector change.**
   Reuse volt-control; mirror the extension's `VoltStatus` (state/status.ts, minus `vscode`) + `panel.ts` /
   `commands.ts` in the Volt Electron shell. *(Corrected: an earlier take routed this through the connector +
   a reverse registry — dropped; the frontend already has its workspace.)*
2. **No IDE / no workspace.** Panel needs empty states ("no IDE connected", "not a Volt workspace").
3. **`volt://` translation.** Shell (main) rewrites `volt://…`→`opencode://…` before dispatching to the pristine
   app's `__OPENCODE__.deepLinks`. Verify every link shape round-trips; register only `volt://` at the OS.
4. **Build channel via env.** Set `OPENCODE_CHANNEL=prod` in the desktop build env; confirm pristine `vite.js`
   picks it up at build (it reads `process.env.OPENCODE_CHANNEL`). Watch for any other channel-dependent default.
5. **Env-wrapper timing (Bun snapshot).** The wrapper MUST set env before opencode's process starts; verify the
   TUI worker then shows the LSP enabled (the exact failure the `tui.ts` seam was patching). Desktop sidecar is a
   fresh spawn → already inherits env. Windows: a `volt` shim exe/script that sets env then `exec`s stock opencode.
6. **No custom binary.** Replace the compiled `volt.exe` with a **pinned stock opencode** binary/release +
   the config bundle. First **verify** the current `volt` binary carries nothing beyond seams #17/#18 (the
   "PLC dispatcher" is config, not compiled code) — if it does, that's extra scope.
7. **Updater coupling.** Stock opencode must NOT self-update (else the binary drifts from our tested config/LSP).
   Disable its self-updater (already seamed via `OPENCODE_DISABLE_AUTOUPDATE`); our installer updates the whole
   bundle together. This is why seam #17 can just be deleted, not replaced.
8. **In-GUI branding.** With `logo.tsx` dropped, the pristine GUI shows opencode's logo internally; the shell
   brands the window/taskbar. Decide per taste: keep `logo.tsx` (1 static seam) for in-GUI Volt identity, or
   accept opencode's. This is the single remaining branding judgment call.
9. **The shell "IDE changes" button.** The mockup's toolbar button is shell chrome, but today `packages/app`
   fills the whole renderer. Two options: (a) shell provides a custom titlebar/chrome hosting the pristine app +
   the button (more shell work, nicer), or (b) **tray-only** access to the panel (simplest, no chrome work).
   Start with (b); add (a) if desired. Neither touches `packages/app`.
10. **Version compat.** The real ongoing cost: our config/tool/LSP must track opencode's tool/LSP/config API.
    Extend `sync.ts` to run `verify-lsp` + `verify-volt-tool` + the conformance corpus against the *pinned stock*
    opencode on every release bump — a compat gate, not a merge.
11. **`window.volt` other consumers.** Before deleting `preload/index.ts` + `volt-control`, grep the pristine app
    for any `window.volt` use beyond the panel. If the panel was the only consumer → delete; else → shrink.
12. **VS Code parity.** The extension's drift coloring and the connector panel should agree — both source the
    connector's bridge data. Not a blocker; keep them consistent.

## Phasing (each step independently verifiable: app still runs + `check-divergence` shrinks)
1. **Panel → connector.** Build the connector IDE-changes view (data + Pull/Push via bundled volt-git). Remove
   the `session.tsx`/`app package.json`/`preload`/`volt-control` seams. Verify parity with the old panel.
2. **GUI-content seams → pristine.** Channel via build-env (drop `vite.js`); `volt://` via shell translation
   (drop `deep-links.ts`); drop `app/index.html`; decide `logo.tsx`.
3. **Binary seams → pristine.** Env-wrapper (drop `tui.ts`); stop injecting `VOLT_UPDATE_REPO` (drop
   `installation/index.ts`); switch to **stock opencode** (verify #6 first).
4. **Tighten the guard.** Shrink `check-divergence` allowlist + add the violation self-tests; run the full sync
   flow; add the per-release compat gate to `sync.ts`.

## Target lifecycle & installer — Volt-owned, two-lane (decided direction)

Two steers converge: **(a) don't intervene in opencode's updater** — opencode updates its own part; **(b) Volt's
installer is Volt's own** — no longer a mirror of opencode's distribution machinery. Net: Volt's distribution is
fully Volt's, scoped to Volt's layer; **opencode is a self-managing dependency.**

### Two update lanes — no overlap, no file touched twice
- **opencode** (agent core) → **its own installer + updater + feed.** Volt REMOVES the `VOLT_UPDATE_REPO`
  injection and never overwrites opencode's files. (The dual-cache bug was Volt racing itself over opencode —
  gone once we stop intervening.)
- **Volt layer** (Electron shell + config bundle + LSP + connector + bridges + `volt` env-wrapper + extension)
  → **Volt's own installer + updater.**

### Volt's installer (its own, scoped to its layer)
- The **Electron shell** keeps electron-builder + electron-updater — because it *is* an Electron app (the right
  tool), NOT because it copies opencode.
- The layer install (config/LSP/connector/bridges/wrapper + PATH + login-item + extension sideload) is Volt's
  NSIS logic.
- opencode is **provisioned, not packaged** → Volt's installer no longer bundles opencode's binary or mirrors its
  `publish.ts`/npm/curl/install-script machinery. **That entire "mirror opencode's distribution" burden in
  `distribution` drops.**

### Provisioning opencode — DECIDED: (A) chain opencode's online installer
`Volt-Setup.exe` runs opencode's official Windows install (scoop/choco/curl) so opencode lands in **its own
dir** and self-updates natively; Volt layers on top pointing at it. One-installer UX, clean two-lane split,
smallest Volt download. Needs internet at install.
- **Edge:** verify opencode's Windows install runs **silently/headless** from the NSIS (no prompts); pick the
  method (scoop vs choco vs a `curl|iex` script) that does. Pin a **minimum** opencode version the Volt layer
  requires; if a newer opencode is already present, use it (don't downgrade).
- **Edge:** **offline install** — with no internet, the chain fails; surface a clear "Volt needs internet once to
  fetch opencode" message + a retry, rather than a broken half-install. (If offline installs become a real
  requirement, revisit option B.)
- Rejected: (B) bundle opencode's installer — offline-capable but bigger + we'd re-ship opencode's setup;
  (C) require opencode pre-installed — worst UX, dev-only.

### The matrix AFTER
| Part | Installed by | Updated by |
|---|---|---|
| opencode core | chained opencode install | **opencode self-update** — Volt never touches |
| Volt Electron shell | Volt NSIS | electron-updater (Volt feed) |
| config / LSP / connector / bridges / wrapper | Volt NSIS | electron-updater (Volt feed — the whole Volt layer, one shot) |
| extension (desktop install) | Volt NSIS sideload, **version-locked** | with the Volt bundle |
| extension (standalone) | Marketplace | Marketplace |
| standalone connector (ext-only) | its installer | connector self-update lane + `protocolVersion` gate |

### Uninstall AFTER
Volt uninstall removes the Volt layer + (opt-in) the Volt data root, and **offers** to remove the chained
opencode (it's opencode's — opt-in, never silent). Single-connector supersede handled; no orphan caches.

### Invariants
- No file installed/updated by two mechanisms.
- All self-updaters that Volt *injected* are removed; opencode's native one stays for opencode.
- The wire `protocolVersion` is the ONLY cross-version negotiation (ext↔connector, update windows).
