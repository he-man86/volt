The follow-on to `minimize-opencode-fork`: lift Volt into a standalone repo that DEPENDS on opencode (runtime +
`@opencode-ai/plugin`) instead of forking it. NOT started — gated on the de-fork landing. Full plan in `design.md`.

## 0. Preconditions
- [ ] `minimize-opencode-fork` landed: core/GUI pristine, panel in the connector, desktop wraps the served GUI,
      no custom binary — the fork is minimal + proven detachable.
- [ ] Dependency audit: confirm the CORE cut (`volt-bridge/git/lsp-iec/vscode/connector/desktop`) depends only on
      **published** opencode packages (`plugin`/`ui`) + the runtime. Flag any private-package dep (`console-*`,
      `session-ui`) → resolve or defer that package to the second cut.

## 1. New repo (core cut)
- [ ] Create the standalone repo; move `packages/volt-*` (core) + `packages/volt-desktop` + `volt-config` +
      `volt-scripts` + `openspec` + `.claude` + `CLAUDE.md` + docs. Decide history (recommend `git filter-repo`).
- [ ] Fresh Volt-only `package.json` / turbo / bun workspace + lint/typecheck/test config.
- [ ] Deps: `@opencode-ai/plugin` (+`ui`) from npm; pin a compatible opencode runtime **range**.

## 2. Desktop shell = wrap the served GUI
- [ ] Rewrite the shell renderer: spawn opencode, load its served GUI URL in a BrowserView, host Volt chrome +
      the connector panel (drop `@opencode-ai/app/vite`).
- [ ] Forward translated `volt://` deep-links into the BrowserView; verify auth/session routing over the served GUI.

## 3. Build / installer (two-lane)
- [ ] Build the shell + config + connector standalone; NSIS **chains opencode's install** + installs the Volt
      layer (per `minimize-opencode-fork` target lifecycle).
- [ ] Verify a fresh install: wrapped desktop loads opencode's served GUI; LSP/tool/bridge/connector all work.

## 4. Tracking + cut-over
- [ ] Retire `check-divergence`; replace `sync.ts` with a compat gate (`verify-lsp` + `verify-volt-tool` +
      corpus vs the pinned opencode release), run on each opencode version bump.
- [ ] Cut over: clean repo is the product repo; archive the old fork (or keep read-only during transition).

## 5. Second cut — commercial/landing
- [ ] Resolve `console-*` / `session-ui` (publish, vendor, or keep coupled); extract `volt-landing` +
      `console`-dependent bits when unblocked.
