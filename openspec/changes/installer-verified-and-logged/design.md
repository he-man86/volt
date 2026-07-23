## Context

`Volt.iss` is 431 lines of Inno Pascal that runs once, silently, on a machine nobody can attach a debugger to.
Its failure modes are all quiet: `Exec` returns a code nobody reads, `RegWriteExpandStringValue` returns a
boolean nobody checks, a `[Run]` entry with `nowait runhidden` swallows its own failure, and `/SUPPRESSMSGBOXES`
turns a locked-file prompt into a silent rollback. Every installer bug in this project was found by re-running
with a change and seeing whether the symptom moved — guessing, not diagnosis.

`SetupLogging=yes` was already on, and `DeinitializeSetup` already mirrored Inno's log into
`%LOCALAPPDATA%\Volt\logs`. That infrastructure is fine. What it recorded was Inno's own file operations and
nothing about Volt's decisions.

## Goals / Non-Goals

**Goals:**
- A support engineer can answer "what did the installer do on this machine, and what failed" from one log file.
- Every line of `Volt.iss` has a stated purpose and evidence it works; anything that cannot be justified is deleted.
- "It works" is asserted by the gate, not claimed by a human reading the script.
- Uninstall is as observable as install.

**Non-Goals:**
- Changing installer behaviour. This pass makes existing behaviour observable and removes what is provably dead.
  Behavioural changes belong to `versioned-install-dirs`.
- Telemetry or any network transmission. Logs stay local; the user chooses to send one.
- Logging secrets. The installer handles none, and none may be added.

## Decisions

**Markers, not prose.** Every logged action starts with a stable `volt:` prefix and a fixed verb, so the gate can
assert on it and support can grep it. Free-text logging is unassertable and drifts; a marker is a contract.

```
volt: junction activated -> C:\...\Volt\app-0.0.1.15810
volt: env OPENCODE_CONFIG_DIR=C:\...\Volt\current\opencode-config
volt: env PATH += C:\...\Volt\current\bin
volt: connector started
```

**Log the decision, not just the action.** "PATH already contains X — left unchanged" is as important as the
write, because the bug it catches is *the write that was skipped for the wrong reason*. Every branch logs which
way it went.

**Every recorded path is resolved and logged when it does not exist.** The `currentin` bug wrote a syntactically
fine, version-free path that pointed nowhere, and both the installer and the gate called it good. A recorded path
that does not exist is always a bug, so the check belongs at the point of writing.

**The gate asserts the marker sequence.** After each install, the newest `install-*.log` must contain the full
expected sequence; after each uninstall, the same for `uninstall-*.log`. This is what makes the audit durable:
delete a step and the gate goes red, rather than the loss surfacing at a customer six weeks later.

*Why assert the log rather than only the end state:* the end state cannot distinguish "the step ran and was
correctly a no-op" from "the step never ran". Those need different fixes, and today they look identical.

**Dead code is deleted, not commented.** An entry kept because it is "probably harmless" is an entry nobody can
reason about — and this file already carries several. If it cannot be shown to do something, it goes; git holds
the history.

**`Exec` results are always captured and logged.** Inno's `Exec` returns whether the process *started*, and the
exit code by reference. Both are recorded, because "did not start" and "started and failed" have different causes.

## Risks / Trade-offs

- **Log volume.** Setup logs are ~300 KB and now grow slightly. Already accepted; timestamped per second so a
  retry cannot overwrite the failure worth reading.
- **A marker changes and the gate breaks.** Intended: the marker list is the contract, so changing one is a
  deliberate edit in two places. Documented in `installer/README.md`.
- **Deleting `[InstallDelete]` removes a guard against a leak that is now prevented upstream** (`CFG_NEVER_SHIP`
  in `build-payload.ts`). Two enforcement points became one. Accepted because the entries provably ran against
  the wrong directory — they were not a second guard, they were a no-op.
- **Scripted edits to `.iss` keep corrupting it** (four times: BEL, VT, and a `\b` that shipped `currentin`).
  The build now refuses a `.iss` containing control characters, and Pascal string literals must be written with
  single backslashes — Pascal has no escape sequences, so `'\\Volt'` is a literal doubled separator.

## Migration Plan

1. Add the markers and the per-branch logging; keep behaviour identical.
2. Delete the dead entries and correct the stale comments, one at a time, each justified in the commit.
3. Teach the gate the marker sequence; confirm it goes RED when a marker is removed before trusting it green.
4. Run the full lifecycle gate with editors open.
5. Record the marker list in `installer/README.md` as the support contract.

**Rollback:** the logging is additive and can be removed without behavioural effect; the deletions are the only
semantic change and each is a single revertible commit.
