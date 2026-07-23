## Why

The installer has been the least trustworthy part of Volt, and every failure has cost hours: a silent rollback
that left `bin/volt.exe` releases behind, a connector that never started, a `PATH` entry that read
`...\Volt\currentin`, an uninstall that left the `current` junction behind. Each was found by *guessing and
re-running*, because the installer does its work silently — `Exec` return codes discarded, registry writes
unchecked, `[Code]` procedures emitting nothing.

That is survivable on the developer's machine. At a customer it is not: there is no debugger, no reproduction,
and the auto-update path runs `/VERYSILENT` with nobody watching. Support needs to answer "what did the
installer actually do on that machine" from a log file, and today it cannot.

The audit behind this change read all 431 lines of `Volt.iss` and found defects that are invisible precisely
because nothing is logged or asserted:

- **Dead `[InstallDelete]` entries.** Four target `{app}\current\opencode-config\*`, but `[InstallDelete]` runs
  *before* `[Files]` and before the junction is repointed — so `current` still resolves to the OLD version,
  which is about to be pruned anyway. They delete nothing that matters and protect nothing.
- **A stale `[UninstallDelete]`** naming the flat `{app}\opencode-config`, a path the versioned layout no longer
  creates.
- **Contradictory `[Run]` comments** — one paragraph explains why the connector is launched there, the next
  explains why it is not. The code does the latter.
- **A `[UninstallRun]` comment** claiming it reverts env, which moved into the uninstaller itself.
- **`PATH` membership tested by substring**, so `...\current\binx` would count as `...\current\bin` — the exact
  class of bug that produced `currentin`.
- **Literal doubled backslashes** in the new `ULog` paths (Pascal has no escape sequences).

The through-line: nothing in the installer is *verified*, so stale code and real bugs are indistinguishable.

## What Changes

- **Every installer action logs what it did and whether it worked** — resolved paths, `Exec` exit codes,
  registry write results, and a `WARNING` whenever a path that was just recorded does not exist on disk. Both
  install and uninstall, in `%LOCALAPPDATA%\Volt\logs` beside the connector's own logs.
- **The lifecycle gate asserts the LOG**, not just the end state. Each installer step emits a stable marker, and
  the gate requires the expected sequence to appear. This is what converts "verified" from a claim into a
  machine-checked fact — and it means a missing step fails CI instead of being discovered by a customer.
- **Every line of `Volt.iss` is accounted for**: each directive and code path either has a stated purpose plus a
  log line proving it ran, or it is deleted. No entry survives on the grounds that it is probably harmless.
- **Dead code removed**: the `[InstallDelete]` block, the stale `[UninstallDelete]`, and the contradictory
  comment blocks.
- **`PATH` membership compared entry-wise** on both the add and remove sides, so the two agree by construction.
- **BREAKING**: none. Behaviour is unchanged except that it is now observable.

## Capabilities

### New Capabilities
- `installer-observability`: what a Volt install and uninstall must record, where, and which of those records the
  lifecycle gate enforces.

### Modified Capabilities
- `versioned-install-layout`: unchanged in intent; its scenarios gain the log assertions that prove them.

## Impact

- `installer/Volt.iss` — the whole file: logging added throughout, dead entries removed, stale comments corrected.
- `volt-scripts/test-install-lifecycle.ts` — asserts the log marker sequence after each install and uninstall.
- `volt-scripts/build-installer.ts` — already refuses a `.iss` containing control characters; extended to require
  that every documented marker is present in the source.
- `installer/README.md` — the marker list becomes the contract support reads.
- No product-code change: this is the installer and its gate only.
