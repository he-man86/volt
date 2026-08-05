# scripts

**One job: ship + verify the whole product.** Everything here spans *all* the `volt-*` packages — so it can't
live in any single package. Package-specific scripts live in that package's `scripts/` dir (map at the bottom).

Every script is listed here. If you add one, add a row — this file existing but being wrong is worse than it not
existing at all.

## The commands

| Command | Script | Does |
|---|---|---|
| `bun run build:installer` | `build-installer.ts` | **the product** → `dist/release/Volt-win-Setup.exe` |
| `bun run test:install` | `test-install.ts` | install → verify → uninstall → verify clean |
| `bun run release [version]` | `release.ts` | PROMOTE a dev build to stable (triggers `promote.yml`) |
| `bun run check` | `check-wiring.ts` | is everything shipped built + internally consistent? |

That's the whole surface. Everything else here is a **step** of one of those, or infra.

## Build → release, end to end

DEV BUILD — every push to `dev` (`release.yml`):
```
build-payload.ts        →  dist/volt/     binaries + docs + .vsix + connector
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
scripts/build-payload.ts`) only to debug that stage; `--no-bridge` skips dotnet.

Useful flags on `build-installer.ts`: `--skip-dist` (reuse the current `dist/volt`), `--rebuild-app` (force
electron-builder), `--upload` / `--upload-only`.

## The wiring check

`bun run check` (`check-wiring.ts`) — built binaries, product-version parity, and **source-extension parity across
every runtime that declares the writable-source set** (C#, the LSP, volt-control, and four separate places in the
VS Code extension manifest). Offline and key-free, so **CI runs it on every push/PR**.

> This used to be `bun run compat`, a two-step gate whose real purpose was `verify-opencode.ts` — driving the
> installed opencode binary to confirm it still loaded Volt's `opencode-config/` layer. Both are deleted along
> with the integration they tested. Volt no longer ships configuration into any agent product, so there is no
> third-party contract left to track: hosts register Volt through their own mechanisms, and the only thing the
> installer publishes is `PATH`.

## Infra (not the Volt product)

| Script | Does |
|---|---|
| `version.ts` | compute the one git-derived version (base from volt-desktop, build = commit count) — `release.yml` injects it |

> **There are no infra scripts any more.** Volt deploys one thing — the static site at `packages/volt-web` —
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

`tsconfig.json` typechecks every script here (pre-push hook + CI: `tsgo --noEmit -p scripts/tsconfig.json`).

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
