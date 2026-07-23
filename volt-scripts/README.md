# volt-scripts

**One job: ship + verify the whole product.** Everything here spans *all* the `volt-*` packages, or checks the
integrated product against the installed opencode — so it can't live in any single package. Package-specific
scripts live in that package's `scripts/` dir (map at the bottom).

Every script is listed here. If you add one, add a row — this file existing but being wrong is worse than it not
existing at all.

## The commands

| Command | Script | Does |
|---|---|---|
| `bun run build:installer` | `build-installer.ts` | **the product** → `dist/release/Volt-win-Setup.exe` |
| `bun run test:install` | `test-install.ts` | install → verify → uninstall → verify clean |
| `bun run release` | `release.ts` | tag `dev` + push → CI builds & publishes |
| `bun run compat` | (chains the 2 checkers below) | does Volt still load in the installed opencode? |

That's the whole surface. Everything else here is a **step** of one of those, or infra.

## Build → release, end to end

```
build-payload.ts        →  dist/volt/     binaries + docs + .vsix + opencode-config + connector
      ↓ (called by)
build-installer.ts      →  dist/release/Volt-win-Setup.exe   (+ electron-builder, + ISCC)
      ↓
test-install.ts            install/uninstall smoke gate — CI runs this BETWEEN build and publish
      ↓
build-installer.ts --upload-only    publishes the GitHub release (= the connector's update feed)
```

`release.ts` sits *outside* that flow: it only tags `dev` and pushes. CI (`release.yml`) runs the pipeline above,
so cutting a release needs no local .NET or Inno Setup.

**`build-payload.ts` deliberately has no `bun run`.** It's a stage, not a destination — "the payload" is just
everything the installer will contain. You want `build:installer`. Run it directly (`bun
volt-scripts/build-payload.ts`) only to debug that stage; `--no-bridge` skips dotnet.

Useful flags on `build-installer.ts`: `--skip-dist` (reuse the current `dist/volt`), `--rebuild-app` (force
electron-builder), `--upload` / `--upload-only`.

## The compat gate

`bun run compat` — run this **when you bump the opencode binary**, not on Volt changes. It answers "does the
current opencode still load Volt's config?", which only changes when *opencode* changes.

| Step | Script | Answers | Needs |
|---|---|---|---|
| 1. integration | `check-wiring.ts` | config layer, built binaries, wire-version + product-version parity, source-extension parity across all runtimes | nothing — **CI runs this on every push/PR** |
| 2. opencode | `verify-opencode.ts` | does the **installed** opencode load the volt LSP **and** the `volt` tool via `OPENCODE_CONFIG_DIR`? | opencode + a configured provider |

Step 2 is the reason the gate exists — it drives the real binary, and nothing else catches opencode changing its
config/LSP/tool contract. Step 1 is included so a local run is complete, but it already gates every PR.

It's a plain `&&` chain in `package.json`, not a script: "run these, stop at the first failure" is exactly what
`&&` is. Each step is runnable alone when one fails, and `verify-opencode` runs both of its checks even if the
first fails — a broken LSP shouldn't hide the tool's result.

> **Known gap:** the verifiers point `OPENCODE_CONFIG_DIR` at the **source** `opencode-config/`, not the built copy in
> `dist/volt/`. The shipped dir differs (the `volt` tool is bundled to `.js` and the `.ts` dropped), so a bundling
> regression in `build-payload.ts` wouldn't be caught here.

## Infra / console (not the Volt product)

| Script | Does |
|---|---|
| `deploy-secrets.ts` | `bun run secrets:dev` — push SST secrets for a stage |
| `set-models.ts` | maintain the console's model catalog |
| `version.ts` | compute the one git-derived version (base from volt-desktop, build = commit count) — `release.yml` injects it |

## Where the package-specific scripts went

| Script | Home |
|---|---|
| `build-cli.ps1` (publish the toolchain), `codesys-pipe.ps1` (headless CODESYS dev loop), `start_pipe.py`/`run_pipe_headless.py` | `packages/volt-cli/scripts/` |
| LSP corpus/conformance recorders + oracles | `packages/volt-lsp-iec/scripts/` |

The installer itself lives at **`installer/`** — `Volt.iss` plus a `README.md` documenting every location Volt
writes on disk.

`tsconfig.json` typechecks every script here (pre-push hook + CI: `tsgo --noEmit -p volt-scripts/tsconfig.json`).

## `test-extension.ts` — the extension-install gate (`bun run test:ext`)

Sideloading a `.vsix` is the ONLY way the Volt extension reaches an editor (release.yml never publishes to the
Marketplace), and that mechanism has three documented sharp edges that silently leave you running old code:

1. **A VSIX-installed extension never auto-updates** — nothing but our installer will ever move it.
2. **`--install-extension` is a no-op unless the version strictly increases.** The local `bun run package` used to
   stamp the base `0.0.1`, lower than every installed dev build, so a local build appeared to install and changed
   nothing. `package` now passes the git-derived version (`version.ts --vsix`) to vsce.
3. **A running editor keeps executing the old extension until it is fully QUIT and reopened** — a window reload is
   not enough. Microsoft closed this as-designed ([vscode#68234](https://github.com/microsoft/vscode/issues/68234)).
   No test can assert around it; the gate prints the reminder.

`bun run test:ext` builds, installs into every editor CLI on PATH, and fails unless each reports exactly one copy
at exactly the expected version. `--verify` inspects what is already installed without building (it can't demand
HEAD's version — that moves with every commit — so it asserts the editors agree instead). Orphaned version folders
are a warning, not a failure: `--uninstall-extension` deregisters immediately but leaves the directory for the
editor to delete at startup, so a machine that never quits its editor always has a few, and they are unregistered.
