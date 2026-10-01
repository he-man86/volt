## Why

**The language server reports SFC step names as unknown members: a false positive on a program that builds
clean.**

Seen in PLCAssist on 2026-09-30 (chat `4b328748`, CODESYS, WAGO PFC300). PLCAssist runs `volt-lsp-iec` as a
snippet check on code it reads and writes, in shadow mode. For `PRG0_Main.prg`:

```
unknown-member  line 65  'S_Boot' is no component of 'PRG0_Main'
```

- `PRG0_Main` is an **SFC** program. `S_Boot` is one of its steps, and the ST text refers to the step's implicit
  state (e.g. `S_Boot.x` / `S_Boot.t`), which CODESYS defines from the chart, not from the declaration.
- The project's builds had no such error, so this is a false positive.
- In shadow mode nobody saw it. It counts against switching the check to BLOCK mode, where it would refuse a
  correct write.

A related effect in the same chat: `PRG_Database.prg` was skipped on every check for size, which is a coverage gap
rather than a false positive.

## What Changes

- **Known SFC step and action names are in scope** for a POU whose body is SFC: each step name resolves to the
  step's implicit structure (`.x`, `.t`, `._x`, … as the dialect defines), and the SFC implicit variables where the
  vendor has them.
- **If the chart is not available to the LSP**, do not report `unknown-member` on a name that could be a step of an
  SFC POU (a known-unknown is not an error). Record in DIALECT.md which of the two the LSP does.

## Impact

- `packages/volt-lsp-iec` (scope/name resolution for POUs with an SFC body), conformance fixtures with an SFC
  program that references its steps.
- The engine only if the SFC step list has to be surfaced to the LSP.
