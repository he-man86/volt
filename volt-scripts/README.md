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
| 1. integration | `check-wiring.ts` | config layer, built binaries, wire-version + product-version parity | nothing — **CI runs this on every push/PR** |
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
| `check-console-divergence.ts` | path-filtered CI (`console-symmetry`) — the vendored console vs upstream opencode |

## Where the package-specific scripts went

| Script | Home |
|---|---|
| `build-cli.ps1` (publish the toolchain), `codesys-pipe.ps1` (headless CODESYS dev loop), `start_pipe.py`/`run_pipe_headless.py` | `packages/volt-cli/scripts/` |
| LSP corpus/conformance recorders + oracles | `packages/volt-lsp-iec/scripts/` |

The installer itself lives at **`installer/`** — `Volt.iss` plus a `README.md` documenting every location Volt
writes on disk.

`tsconfig.json` typechecks every script here (pre-push hook + CI: `tsgo --noEmit -p volt-scripts/tsconfig.json`).
