# volt-scripts

**One job: verify + ship the whole product against the opencode runtime.** Everything here spans *all* the
`volt-*` packages or checks the integrated product against installed opencode — so it can't live in any single
package. Package-specific scripts live in that package's `scripts/` dir (see the map at the bottom).

## When do I run these?

**Bumped the opencode binary? Run the compat gate:**

```bash
bun run compat        # → volt-scripts/sync.ts
```

Runs the three checks below in order, stops at the first failure. Exit 0 = Volt still loads in this opencode.
That's the only command you normally need; the rest are its steps, runnable alone when one fails:

| Step | Command | Answers |
|---|---|---|
| 1. integration | `bun run volt-scripts/check-volt-integration.ts` | Are the config layer, built binaries, and wire-version parity all present? (key-free — this is what CI runs) |
| 2. lsp loads | `bun volt-scripts/verify-lsp.ts` | Does the **installed** `opencode` load the volt LSP via `OPENCODE_CONFIG_DIR`? |
| 3. tool loads | `bun volt-scripts/verify-volt-tool.ts` | Does the **installed** `opencode` load the `volt` custom tool? (needs a configured provider) |

**Cutting a release? Build the bundle:**

```bash
bun run dist          # → dist/volt/  (volt.exe + volt-lsp-iec.exe + volt-config + .vsix + connector)
```

`dist.ts` runs the standard `bun build --compile` for each binary, then gathers the config/docs/vsix/connector
into one shippable folder. The installer (`packages/volt-bridge/installer/`) bundles that folder.

`tsconfig.json` typechecks every script here (pre-push hook + CI: `tsgo --noEmit -p volt-scripts/tsconfig.json`).

## Where the package-specific scripts went

| Script | Home | Why |
|---|---|---|
| `volt`, `volt.cmd` (CLI dev wrappers) | `packages/volt-git/scripts/` | they run the volt-git binary |
| `build-bridges.ps1`, `bridge.ps1`, `codesys-bridge.ps1`, `harvest-corpus.ts` | `packages/volt-bridge/scripts/` | bridge build + dev-loop + corpus |
| `volt-path.ps1`, `volt-extension.ps1` (installer helpers) | `packages/volt-bridge/installer/` | called by `connector.nsh` |
| LSP corpus/conformance recorders + oracles | `packages/volt-lsp-iec/scripts/` | analyze the LSP |
