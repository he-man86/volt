> Owner, 2026-10-23: "do it now". Proposed by PLC Assist, whose release gate already follows the same rules.

## Why

Volt's runs and PLC Assist's gates share one machine's CODESYS and TwinCAT. On 2026-10-23 a stopped matrix left its
CODESYS open, PLC Assist's gate reused IDEs another run had left and failed on them, and then left its own open — and
neither side may close the other's. A chat "hold" decides who goes first; it does not stop a collision.

## What Changes

- **A run is a set of `ide.ps1` instances**: `-Run <tag>` (else `$VOLT_IDE_RUN`, else the instance name). A run owns the
  instance named by its tag and every instance named `<tag>-…`. The matrix is run `release-matrix`; a workflow is its
  change name; the mixed-version cell's instances sit under the matrix's.
- **`up` refuses to start beside a foreign IDE**: any CODESYS / TcXaeShell / VoltBridgeTwincat process that no instance
  of the run recorded is named by pid and command line, and nothing starts. The check and the launch are one step
  (a machine-wide launch lock), so two cells of one run starting together never see each other half-launched.
- **`ide.ps1 check`** gives that answer without starting anything; the matrix asks it once, before any cell.
- **A run closes its own instances on every exit** it can hook (pass, fail, thrown error, Ctrl+C), and at its START,
  so a run that was killed outright is cleaned by the next one.
- **Always fresh**: `up` never attaches to an IDE or bridge it did not start (already true; now stated).

## Impact

`packages/volt-cli/scripts/ide.ps1` (+ `ide-run.ps1`), `scripts/release-matrix.ts`,
`packages/volt-cli/scripts/{mixed-version,vendor-facts,completeness,corpus-migration}.ts`, docs (CLAUDE.md,
`scripts/README.md`, `packages/volt-cli/test/e2e/README.md`). An engineer's own IDE, the connector's TwinCAT worker or
another session's run now makes `up` refuse — by design: the user decides; Volt never drives or closes it.
