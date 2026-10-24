# Design

**Owner = the instance's pid record, never a process name.** `ide.ps1` already decides "ours" per instance from its pid
record (`Test-Ours`: pid + start time, recorded parents, a TwinCAT worker attached to a recorded XAE). A run's own
processes are the union of that answer over the run's instances, both vendors. Every other process of the three IDE
images is foreign. No fallback: a record that cannot be read names nothing, so its processes are foreign.

**Run membership by instance name.** Tag `T` owns instance `T` and `T-*`; the empty tag owns only the default instance.
Chosen over an owner file written by `up` because the mixed-version cell serves the PREVIOUS release's `ide.ps1`, which
writes no such file but does write the same pid record under the instance name the matrix gives it. Ceiling: two runs
with one tag at once (two matrices) count each other as own; the per-instance lock still keeps them off one instance.

**Check and launch under one lock.** A machine-wide mutex `Local\volt-ide-launch` is taken before the foreign check and
released once the launched IDE is recorded (`Save-Pids`). A sibling's IDE is therefore either not started yet or
already recorded when the check runs; CODESYS's re-exec'd child is found through its recorded parent, the TwinCAT worker
(spawned later) through its recorded XAE. The wait for the lock is bounded (10 min); a timeout names the lock.

**Close on exit.** Scripts register SIGINT/SIGTERM/SIGHUP handlers that run `down` synchronously for every instance they
own, beside their existing `finally`. A hard kill runs no hook; the matrix therefore downs every instance of its run
before its first cell, and `up` already closes its own instance's orphaned worker.

**Testable core**: run membership and the foreign selection are pure PowerShell functions in
`packages/volt-cli/scripts/ide-run.ps1`, dot-sourced by `ide.ps1`, tested offline by `test/unit/ide-run.test.ts`.

**One function decides and words the refusal** (`Get-ForeignRefusal`, live finding 1.6). Windows PowerShell hands a
function's one-element array to its caller as the bare element, whose `.Count` a `[pscustomobject]` does not answer, and
an empty one as `$null`, which a pipeline carries as one process: the matrix started beside one foreign CODESYS and
refused an empty machine. The selection stays an array inside the one pure function both `up` and `check` call.
