Lift Volt into a standalone repo that DEPENDS on opencode (runtime + `@opencode-ai/plugin`) instead of forking
it. Done **in place** (delete opencode source from this repo) rather than a fresh-repo lift — same end state,
keeps history/CI. Full plan in `design.md`.

## 0. Preconditions
- [x] `minimize-opencode-fork` landed: core/GUI pristine, panel in the connector, desktop wraps the served GUI,
      no custom binary — the fork is minimal + proven detachable.
- [x] Dependency audit: the CORE cut (`volt-bridge/git/lsp-iec/control/vscode/desktop`) depends only on other
      `volt-*` packages + `@opencode-ai/plugin` (npm, in volt-config) + the runtime. Only `volt-landing` is
      entangled (private `console-*`) → deferred to the second cut.

## 1. Standalone repo (core cut) — in place
- [x] Deleted all opencode source (`packages/{opencode,core,server,llm,tui,app,ui,desktop,sdk,plugin,schema,…}`,
      `console/*`, `stats/*`), infra/SST, nix, patches, opencode CI workflows + translated READMEs, and the fork
      machinery (`check-divergence`, `merge-upstream`, `dev.ts`, root `.opencode/`).
- [x] Fresh Volt-only root: `package.json` (explicit `volt-*` workspace + trimmed catalog), `turbo.json`,
      `bunfig.toml`; promoted `volt-config/` to the repo root. `bun install` 22 pkgs; `turbo typecheck` 5/5.
- [x] Deps: `@opencode-ai/plugin` already pinned to npm `1.17.18` in `volt-config`; the runtime is the installed
      `opencode` binary on PATH. (A pinned-range compat policy can tighten this later.)

## 2. Desktop shell = wrap the served GUI
- [x] `volt-desktop` already spawns the installed `opencode serve` + loads its GUI in a `WebContentsView` with
      Volt chrome + the IDE panel over `volt-control` (landed in the de-fork).
- [ ] Forward translated `volt://` deep-links into the view; verify auth/session routing over the served GUI.

## 3. Build / installer (two-lane) — the `distribution` change
- [ ] Build the shell + config + connector standalone; NSIS chains opencode's install + installs the Volt layer.
- [ ] Verify a fresh install: wrapped desktop loads opencode's served GUI; LSP/tool/bridge/connector all work.

## 4. Tracking + cut-over
- [x] Retired `check-divergence`; `sync.ts` is now the compat gate (install → integration → verify-lsp →
      verify-volt-tool, driving the installed `opencode`). Rewrote `volt-ci.yml` + `.husky/pre-push` (no
      fork-surface guard). Green end-to-end.
- [ ] Cut over: make this the product repo (rename/settle the `dev` branch + remotes; drop the `upstream`/`sst`
      remotes that pointed at opencode).

## 5. Second cut — commercial/landing
- [x] `volt-landing` **removed from the repo** (git-recoverable) — the landing page is unimplemented and its
      opencode `console-*` coupling made it dead weight. A fresh implementation is tracked in
      `openspec/changes/commercial-landing/`.
