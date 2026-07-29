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
| `bun run release [version]` | `release.ts` | PROMOTE a dev build to stable (triggers `promote.yml`) |
| `bun run compat` | (chains the 2 checkers below) | does Volt still load in the installed opencode? |

That's the whole surface. Everything else here is a **step** of one of those, or infra.

## Build → release, end to end

DEV BUILD — every push to `dev` (`release.yml`):
```
build-payload.ts        →  dist/volt/     binaries + docs + .vsix + opencode-config + connector
      ↓ (called by)
build-installer.ts      →  dist/release/Volt-win-Setup.exe   (+ electron-builder, + ISCC)
      ↓
build-installer.ts --upload-only --prerelease   publishes a PRERELEASE 0.0.1.<count> (the dev channel)
```

RELEASE — promote one of those builds to prod (`release.ts` → `promote.yml`):
```
release.ts             triggers promote.yml for a chosen 0.0.1.<count> (via `gh`; nothing installs locally)
      ↓ (in CI, on a clean Windows runner)
verify                 the build is a published prerelease AND its commit's ci.yml is green
      ↓
gh release download    that build's OWN Volt-win-Setup.exe
      ↓
test-install.ts            install/uninstall smoke gate  ┐ gate the EXACT build being released, so
test-install-lifecycle.ts  install/update/uninstall ×N   ┘ what ships to stable is what was tested
      ↓
gh release edit --prerelease=false --latest     flips it to the stable channel
```

Both install gates read the installer's on-disk contract (install dir, the `{app}\current` junction, the uninstall
key, the reg reader) from **`install-layout.ts`** — ONE source of truth, so the smoke gate can't drift from the
lifecycle gate the way it once did (it hardcoded the pre-junction flat layout and rotted unnoticed, because the
install gates ran only at release and none had been cut — the first cut then failed on months-old wrong paths).
`test-install.ts` adds BEHAVIOUR on top: it runs the installed CLIs (`--version`), not just file checks.

`release.ts` is only a TRIGGER — it points a build at `promote.yml` (or you Run the workflow from the Actions tab).
The gating + the flip run in CI, so releasing needs no local .NET or Inno Setup, and never installs on your box.

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
| 1. integration | `check-wiring.ts` | config layer, built binaries, wire-version + product-version parity, source-extension parity across all runtimes, model-catalog parity | nothing — **CI runs this on every push/PR** |
| 2. opencode | `verify-opencode.ts` | does the **installed** opencode load the volt LSP **and** the `volt` tool via `OPENCODE_CONFIG_DIR`? | opencode + a configured provider |

Step 2 is the reason the gate exists — it drives the real binary, and nothing else catches opencode changing its
config/LSP/tool contract. Step 1 is included so a local run is complete, but it already gates every PR.

It's a plain `&&` chain in `package.json`, not a script: "run these, stop at the first failure" is exactly what
`&&` is. Each step is runnable alone when one fails, and `verify-opencode` runs both of its checks even if the
first fails — a broken LSP shouldn't hide the tool's result.

> **Known gap:** the verifiers point `OPENCODE_CONFIG_DIR` at the **source** `opencode-config/`, not the built copy in
> `dist/volt/`. The shipped dir differs (the `volt` tool is bundled to `.js` and the `.ts` dropped), so a bundling
> regression in `build-payload.ts` wouldn't be caught here.

## Infra (not the Volt product)

| Script | Does |
|---|---|
| `version.ts` | compute the one git-derived version (base from volt-desktop, build = commit count) — `release.yml` injects it |

> **There are no infra scripts any more.** Volt deploys one thing — the static site at `packages/volt-www` —
> and it needs no secrets: `bunx sst deploy --stage <stage>` with a `CLOUDFLARE_API_TOKEN`. See `infra/README.md`.
>
> Deleted with the gateway and the vendored console: `deploy-secrets.ts`, `set-models.ts`,
> `gen-model-config.ts` and `update-models.ts`. Payment, EU VAT, licence keys and the customer portal are
> Polar's, so there is no catalog to publish and no secret to provision.

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

## `test-install-lifecycle.ts` — the install LIFECYCLE gate (`bun run test:install:lifecycle`)

`test:install` proves ONE install and ONE uninstall are clean. It cannot catch what actually shipped, because
those failures need an install **over an existing one**, with files held open:

- A silent update **aborted and rolled back** because a running editor held `bin\volt-lsp-iec.exe`. Inno retried,
  hit an Abort/Retry/Ignore box that `/SUPPRESSMSGBOXES` defaults to **Abort**, and reverted — silently, exit code
  and all. Files sorting after the locked one (notably `bin\volt.exe`) stayed several releases behind while the
  connector moved on, so a shipped CLI feature looked broken for days.
- **A version could be reported without being installed.** The tray once trusted a `version.txt` the installer
  wrote; it asserted nothing about the binaries beside it, so a half-applied install reported the version it
  *meant* to be. That file is gone — every binary now carries its version stamped in.

The flow: `install → uninstall → install → update → update → uninstall → install → uninstall`, asserting after
every step. Two assertions carry the weight:

- **Measured versions, not paperwork.** `build-cli.ps1` stamps `VOLT_VERSION` into every exe's `FileVersion` (the
  bun-compiled LSP gets it via a compile-time `--define`), so each binary is asked what it *is* and compared
  against the version directory Inno created. Comparing binaries only to each
  other is not enough — an update that replaced none of them would be self-consistent and still stale. The
  extension is checked the same way, via the editor's own `--list-extensions --show-versions`; folder listings are
  not evidence (they survived both an uninstall that deregistered it and an install that skipped it).
- **Rollback detection** — the setup log is read for `Rolling back changes` / in-use aborts, because Inno can exit
  0 on those paths.

`--older <setup.exe>` installs the newer build over an older one, which is the case that broke; without it the
same build is reinstalled over itself (still exercises the file-in-use path). Windows only, really installs
several times — throwaway machine or CI runner.

**To reproduce the original bug, run it with an editor open.** That is the state every real user is in.
