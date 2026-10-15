# scripts

**One job: ship + verify the whole product.** Everything here spans *all* the `volt-*` packages — so it can't
live in any single package. Package-specific scripts live in that package's `scripts/` dir (map at the bottom).

Every script is listed here. If you add one, add a row — this file existing but being wrong is worse than it not
existing at all.

## The commands

| Command | Script | Does |
|---|---|---|
| `bun run build:installer` | `build-installer.ts` | **the product** → `dist/release/Volt-win-Setup.exe` |
| `bun run test:install` | `test-install.ts` | install/uninstall/update ×N on a real machine, asserting after every step |
| `bun run release:matrix` | `release-matrix.ts` | THE LIVE RELEASE GATE: e2e over every installed IDE variant, the matrix printed, a red cell fails |
| `bun run release [version]` | `release.ts` | PROMOTE a dev build to stable (refuses without a green `release:matrix` on that build's commit; triggers `promote.yml`) |
| `bun run check` | `check-wiring.ts` | is everything shipped built + internally consistent? |
| `bun run console` | `packages/volt-cli/scripts/console.ts` | build the CLI + serve the interface console (the docs, and a client that can call all three surfaces) |

That's the whole surface. Everything else here is a **step** of one of those, or infra.

## Build → release, end to end

DEV BUILD — on demand (Actions → `release` → Run workflow, `release.yml`):
```
build-payload.ts        →  dist/volt/     bin/ (+ bin/git, the CLI's MinGit) connector/ codesys/ (no .vsix — the installer no longer sideloads the extension)
      ↓ (called by)
build-installer.ts      →  dist/release/Volt-win-Setup.exe   (+ electron-builder, + ISCC)
      ↓
build-installer.ts --upload-only                publishes a PRERELEASE 0.1.<count> (the dev channel — always; no flag)
```

RELEASE — promote one of those builds to prod (`release.ts` → `promote.yml`):
```
release-matrix.ts      on the dev machine, at that build's commit: e2e over every installed IDE variant
      ↓                (CI has no CODESYS/TwinCAT) → dist/release-matrix/result.json, green on that commit
release.ts             checks that result, attaches it to the release as release-matrix.json, then triggers
                       promote.yml for a chosen 0.1.<count> (via `gh`; nothing installs locally)
      ↓ (in CI, on a clean Windows runner)
verify                 the build is a published prerelease AND its commit's ci.yml is green
      ↓
verify                 its attached release-matrix.json is green on its own commit (`release-matrix.ts --verify`)
      ↓
gh release download    that build's OWN Volt-win-Setup.exe
      ↓
test-install.ts        install/update/uninstall ×N, upgrading from the current stable — gates the
      ↓                EXACT build being released, so what ships to stable is what was tested
gh release edit --prerelease=false --latest     flips it to the stable channel
```

**There is ONE install gate.** There were two — a smoke gate (one install, one uninstall) and this lifecycle
gate, which *opens* with the same install/uninstall and then keeps going. The smoke gate was a strict subset, and
weaker where they overlapped: it checked that files exist, while this one asks each binary for its stamped
`FileVersion` and compares it to what the install claims. Running both cost a full extra install cycle on the
release runner to re-prove what the next step re-proved.

Merging them was not free of information, though, and that is the lesson worth keeping: the smoke gate held three
assertions this one lacked (the tray process is running, the Start Menu shortcut and login item exist) and — the
reason to be careful — it read the login-item registry value by its **real** name, `VoltConnector`, while this
gate read `"Volt"` and could therefore never fail. Two gates asserting the same thing in two ways is how the
wrong one hides. All four are folded in; `installer/Volt.iss` had the same wrong name in its uninstall fallback
and is fixed too.

The installer's on-disk contract (install dir, the four folders, the stamped binaries, the uninstall key, the reg
reader) used to live in a separate `install-layout.ts` precisely so the two gates could not drift — they had each
carried a private copy, and when the payload moved under a junction only one was updated, so the other spent months
checking paths that no longer existed. With one gate that module had no one to share with; it is inlined at the top
of `test-install.ts`, beside its only reader, and names the same paths as `dist/stage` and `installer/README.md`.

`release.ts` is only a TRIGGER — it points a build at `promote.yml` (or you Run the workflow from the Actions tab).
The gating + the flip run in CI, so releasing needs no local .NET or Inno Setup, and never installs on your box.

**`build-payload.ts` deliberately has no `bun run`.** It's a stage, not a destination — "the payload" is just
everything the installer will contain. You want `build:installer`. Run it directly (`bun
scripts/build-payload.ts`) only to debug that stage; `--no-bridge` skips dotnet.

**`binary-targets.ts` is a step of `build-payload.ts`** (its self-check, after the by-name file list): it reads the PE
header of every `.exe`/`.dll` in the payload and refuses one built for a CPU its place does not allow — the in-proc
CODESYS DLLs AnyCPU (every DLL under `codesys/` — 32- and 64-bit CODESYS load them), `VoltTwincatExplorer.exe` x86 (XAE's own x86 proxy),
MinGit's `bin/git/usr/libexec/getprocaddr32.exe` x86 (its helper for interrupting a 32-bit child), everything
else x64/AnyCPU (openspec environment-dependency-audit 1.2). Run it directly (`bun scripts/binary-targets.ts [dir]`)
on a `dist/volt` or an installed `{app}` (where Inno's uninstaller `unins000.exe` — or the next free number — is x86, and allowed). What a PE header cannot say (the LSP's `-baseline` bun target, the installer's
`ArchitecturesAllowed`) is held as text by `Volt.Repo.Gates/ShippedBinaryTargetTests`.

Useful flags on `build-installer.ts`: `--skip-dist` (reuse the current `dist/volt`), `--rebuild-app` (force
electron-builder), `--upload` / `--upload-only`.

**The product ships with LD and FBD off.** Network text is on only in a process whose environment holds
`VOLT_GRAPHICAL=1`, and nothing on this path sets it — not `build-payload.ts`, not `build-installer.ts`, not
`installer/Volt.iss`, not `build-cli.ps1` — so an installed bridge pulls every LD and FBD body as
`IMPLEMENTATION LD|FBD UNSUPPORTED`. Development turns it on: `ide.ps1`, the test suites, the e2e and recording
scripts (`packages/volt-cli/README.md`, "LD and FBD are off unless `VOLT_GRAPHICAL=1`"). To try a shipped build with
it on, set it in the environment of the process that runs the bridge (CODESYS, or the TwinCAT worker), and of the
editor for the LSP's own switch. `Volt.Repo.Gates/NetworkTextSwitchTests` fails if a shipping step starts setting it.

## `release-matrix.ts` — the live release gate (`bun run release:matrix`)

CI's runners have no CODESYS and no TwinCAT, so the e2e suite only ever ran by hand, on one IDE — and that is how two
regressions shipped green: the TwinCAT bridge needed a proxy only Visual Studio registers (every test machine had
Visual Studio), and an SP18 member absence failed 212 of 218 e2e tests while SP21 was green (openspec
environment-dependency-audit). The matrix runs the WHOLE `packages/volt-cli/test/e2e` suite once per installed IDE
variant — every `CODESYS <version>` under `Program Files` (64-bit) and `Program Files (x86)` (32-bit), every registered
XAE shell by its exe's PE bitness — each served by `ide.ps1 up -Instance release-matrix` on that variant's own fixture,
then prints the matrix and exits non-zero on any red cell. `release.ts` refuses to promote a build unless
`dist/release-matrix/result.json` says green for that build's commit (a checkout with modified or untracked files
outside `openspec/` records NOT green — an untracked source file is built into what ran), then attaches it to the release
as `release-matrix.json`; `promote.yml` checks that attachment against the release's own commit
(`release-matrix.ts --verify`), so the Actions door to a release cannot skip the matrix. A vendor with no install on
the machine is one red cell (`codesys-none`, `twincat-none`), never a missing one. A cell is
red, by name, when its version has no native fixture project (`CodesysTestProject.<version>.project`; until 2.5b makes
them only 3.5.21.40 and 3.5.18.30 have one — owner: a project opened from another version's file is not native), when
a TwinCAT cell would run where Visual Studio's 64-bit msenvp proxy is registered (DIALECT C2t — not the customer's
machine), when the IDE does not come up, when any test fails, or when the harness's own report (`VOLT_E2E_REPORT`: the
version and bitness the run drove, from `health` and the IDE process) names another IDE than the cell's.
`--list` prints the cells; `--only <id,id>` and `--tests <path>` run a subset, printed as PARTIAL and never written as a
result. Per-cell logs land in `dist/release-matrix/<cell>.log`. Long (the sum of full e2e runs); Windows only.

## The VM checklist — before a release that touches a bridge or the installer

What the dev machine cannot be. Each cell is one VM (or one machine) in that state, with the product INSTALLED from
the release candidate's `Volt-win-Setup.exe`, the cell's checks run by hand, and the result recorded in the release's
notes (date, build, pass/fail and what failed). The `release:matrix` above runs on the dev machine; these do not.

| # | State | Checks |
|---|---|---|
| 1 | TwinCAT 3.1.4024 only — no Visual Studio, no Git for Windows (the field bug's machine) | the connector serves an XAE (no `IDE_UNSUPPORTED`); `volt init/pull/push/status`; a build with an error lists it |
| 2 | Windows system locale tr-TR, then ru-RU (system locale + display language), real CODESYS and XAE | as 1, on each IDE; `volt pull` of a project with `VAR_IN_OUT` and `I`/`i` identifiers; a build with an error |
| 3 | Windows 10 LTSC 2019 (.NET Framework 4.7.2, no 4.8) | the installer runs; the TwinCAT hierarchy read (`VoltTwincatExplorer.exe`, net472); no .NET install dialog |
| 4 | A non-admin user whose name is Cyrillic (`C:\Users\Тест`: `%TEMP%`/`%APPDATA%` non-ASCII), system code page 1252 | install, connector, CODESYS activation, TwinCAT pull/push, a TwinCAT folder move and a graphical create (both hand XAE a `%TEMP%` path) |
| 5 | No git on PATH | `volt init/pull/push` run on the bundled `bin\git` |
| 6 | A CPU without AVX2 (or a VM that masks it) | the LSP (`volt-lsp-iec.exe`, bun `x64-baseline`) starts and answers |
| 7 | CODESYS and XAE started "as administrator", Volt not (2.2) | CODESYS serves through `PipeAcl`; `volt status` names an elevated XAE (`UnreachableXae`); the UI's "An IDE Volt cannot reach" row; the e2e names the bitness unreadable and runs on; then start `VoltConnector.exe` elevated and run the per-user setup: it refuses at once, naming the elevated process (`installer/README.md`) |
| 8 | WMI service disabled (`sc config winmgmt start= disabled`, reboot) | install, update and uninstall complete (the installer reads processes from kernel32's snapshot, `installer/Processes.iss`) |

Last run: openspec `environment-dependency-audit` 3.2 records what the dev machine could stand in for and what is
still owed to a VM.

## The wiring check

`bun run check` (`check-wiring.ts`) — built binaries, product-version parity, and **source-extension parity across
every runtime that declares the writable-source set** (C#, the LSP, volt-control, four separate places in the
VS Code extension manifest, and the Claude Code plugin's `extensionToLanguage` in `plugins/volt-lsp`), and **materialization parity** — the format number the C# CLI writes on every library
manifest (`LibraryManifest.Materialization`) against the one the LSP reads (`MATERIALIZATION`), since a mismatch
silences every network-text diagnostic. Offline and key-free, so **CI runs it on every push/PR**.

> This used to be `bun run compat`, a two-step gate whose real purpose was `verify-opencode.ts` — driving the
> installed opencode binary to confirm it still loaded Volt's `opencode-config/` layer. Both are deleted along
> with the integration they tested. Volt no longer ships configuration into any agent product, so there is no
> third-party contract left to track: hosts register Volt through their own mechanisms, and the only thing the
> installer publishes is `PATH`.

## Infra (not the Volt product)

| Script | Does |
|---|---|
| `version.ts` | compute the one git-derived version (base from volt-desktop, build = commit count) — `release.yml` injects it |
| `measure-payload.ts` | read-only: the installer payload per component (`dist/stage`, uncompressed, MiB) + the installer size — `bun scripts/measure-payload.ts [stage] [installer]`; buckets by role (same rows for the old and the new layout), refuses an unclaimed file or an empty required lever |

> **There are no infra scripts any more.** Volt deploys one thing — the static site at `packages/volt-web` —
> and it needs no secrets: `bunx sst deploy --stage <stage>` with a `CLOUDFLARE_API_TOKEN`. See `infra/README.md`.
>
> Deleted with the gateway and the vendored console: `deploy-secrets.ts`, `set-models.ts`,
> `gen-model-config.ts` and `update-models.ts`. Payment, EU VAT, licence keys and the customer portal are
> Polar's, so there is no catalog to publish and no secret to provision.

## Where the package-specific scripts went

| Script | Home |
|---|---|
| `build-cli.ps1` (publish the toolchain), `ide.ps1` (CODESYS dev loop, through the shipped host), `run_pipe_production.py`, and the **live-IDE probes** — each mapped in its own `README.md` there | `packages/volt-cli/scripts/` |
| LSP corpus/conformance recorders + oracles | `packages/volt-lsp-iec/scripts/` |

The installer itself lives at **`installer/`** — `Volt.iss` plus a `README.md` documenting every location Volt
writes on disk.

`tsconfig.json` typechecks every script here (pre-push hook + CI: `tsc --noEmit -p scripts/tsconfig.json`).

## `test-extension.ts` — the extension-install gate (`bun run test:ext`)

The installer no longer carries the extension (openspec installer-rebuild); until it ships from the Marketplace
(openspec `vscode-extension-marketplace`), sideloading a `.vsix` is the only way it reaches an editor, and that
mechanism has three documented sharp edges that silently leave you running old code:

1. **A VSIX-installed extension never auto-updates** — nothing moves it but another sideload.
2. **`--install-extension` is a no-op unless the version strictly increases.** The local `bun run package` used to
   stamp the base `0.0.1`, lower than every installed dev build, so a local build appeared to install and changed
   nothing. `package` now passes the git-derived version (`version.ts --version`) to vsce.
3. **A running editor keeps executing the old extension until it is fully QUIT and reopened** — a window reload is
   not enough. Microsoft closed this as-designed ([vscode#68234](https://github.com/microsoft/vscode/issues/68234)).
   No test can assert around it; the gate prints the reminder.

`bun run test:ext` builds, installs into every editor CLI on PATH, and fails unless each reports exactly one copy
at exactly the expected version. `--verify` inspects what is already installed without building (it can't demand
HEAD's version — that moves with every commit — so it asserts the editors agree instead). Orphaned version folders
are a warning, not a failure: `--uninstall-extension` deregisters immediately but leaves the directory for the
editor to delete at startup, so a machine that never quits its editor always has a few, and they are unregistered.

## `test-install.ts` — the install gate (`bun run test:install`)

Proving ONE install and ONE uninstall clean is not enough, which is why this runs a sequence. The failures that
actually shipped need an install **over an existing one**, with files held open:

- A silent update **aborted and rolled back** because a running editor held `bin\volt-lsp-iec.exe`. Inno retried,
  hit an Abort/Retry/Ignore box that `/SUPPRESSMSGBOXES` defaults to **Abort**, and reverted — silently, exit code
  and all. Files sorting after the locked one (notably `bin\volt.exe`) stayed several releases behind while the
  connector moved on, so a shipped CLI feature looked broken for days.
- **A version could be reported without being installed.** The tray once trusted a `version.txt` the installer
  wrote; it asserted nothing about the binaries beside it, so a half-applied install reported the version it
  *meant* to be. That file is gone — every binary now carries its version stamped in.

The flow (openspec installer-rebuild, design 1): **1** install `--older` → **2** update to the new build → **3** update again (files in use) →
**4** update with a `volt.exe` alive and `/VOLTWAIT=15`: setup gives up non-zero, the CLI is **not killed**, no
binary is replaced, nothing is stopped (the tray's pids unchanged — the TwinCAT worker is the far end of the CLI's
pipe) → **5** the same, the CLI stopped 5 s into the wait: setup completes
→ **6** uninstall with the CLI alive: aborted, nothing removed → **7** uninstall → **8** fresh install → **9**
uninstall → **10** `UpdaterVerificationTests` (a tampered or digest-less download is refused by name). Every check
is **hard** — there is no "warn" any more. What carries the weight:

- **Measured versions, not paperwork.** Add/Remove `DisplayVersion` must equal the setup's own ProductVersion, and
  every stamped binary (`build-cli.ps1` stamps `VOLT_VERSION`; the bun-compiled LSP gets it via `--define` and is
  asked with `--version`) must report it. Comparing binaries only to each other is not enough — an update that
  replaced none of them would be self-consistent and still stale.
- **The published surface, exactly:** the Start Menu shortcut's target (`desktop\VoltDesktop.exe`), the Run value's
  data, the PATH entry (`{app}\bin` once, nothing else under `{app}`, every other entry untouched — uninstall must
  give back the PATH value the run started with byte for byte: its existence, its registry type and its exact
  unexpanded string, a trailing `;` included — not just the same `;`-split entries), the `WM_SETTINGCHANGE("Environment")` broadcast observed by a
  hidden window while setup runs, the Documents\Volt scripts (byte-identical to this install's copies, polled
  after the tray is seen running FROM `{app}` — by executable path, never image name), and the bridge DLL resolved through the installed
  script's `_INSTALL_SUBDIR` with no `VOLT_BRIDGE_DLL`.
- **Rollback detection** — the setup log is read for `Rolling back changes` / in-use aborts, because Inno can exit
  0 on those paths.

`--older <setup.exe | previous>` is **required** (`previous` downloads the newest published build older than the
one under test with `gh`); a run
without an upgrade, or with an "older" that is not older, is refused by name. The gate also refuses to start where
Volt is already installed, a Volt process or any `volt.exe` runs (a dev tray, another session's CLI — every setup
would wait on it), any published fact (shortcut, Run value, Documents scripts) is already there —
a leftover would pass an assertion the installer never earned — or no dotnet has a .NET 10 SDK (step 10). Every
log check reads only the bytes THAT step appended to the mirrored log (the uninstaller appends a whole day to one
`uninstall-<date>.log`), and every uninstall log line must carry `volt:`. Steps 4–6 read the exact `volt: waiting
for volt.exe` / `volt: gave up waiting for volt.exe` lines, never a bare `volt.exe`; steps 4 and 6 require the SAME
tray pids and no `volt: stopped ` line, step 5 the stop AFTER the wait, and step 6 every installed file, the
Documents scripts and the tray to survive the abort. A hung setup is killed with its whole process tree. Windows only, really installs several times — throwaway machine or CI runner. It starts
a connector, which spawns a worker for every open TwinCAT XAE, so do not run it beside someone else's live IDE.

**To reproduce the original bug, run it with an editor open.** That is the state every real user is in.
