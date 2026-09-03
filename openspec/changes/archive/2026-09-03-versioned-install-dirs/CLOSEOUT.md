# Close-out — shipped; the checklist was never ticked

Closed 2026-09-03 with 0 of 24 boxes ticked and the change substantively **done**. The work landed through
ordinary installer work and the list was never walked back, so the boxes and the tree drifted apart. Judged
against `installer/Volt.iss` and `scripts/test-install.ts` rather than against the list:

| Task | State |
|---|---|
| §2.1 point `[Files]` at `{app}\app-{#AppVersion}` | **shipped** — `Volt.iss:68`, `DestDir: "{app}\app-{#AppVersion}"` |
| §2.2 junction management, `{app}\current` repointed to the new version dir | **shipped** — created at `ssPostInstall`; `UninstallDisplayIcon={app}\current\...` |
| §1.x every externally-referenced path resolves through the junction | **shipped** — and its edge cases are documented in the `.iss` itself: `[Run]` executes BEFORE `current` exists, so those entries deliberately name the VERSION directory |
| the whole install verified THROUGH the junction | **shipped** — `scripts/test-install.ts:42,52,219`; it also records the bug where only one of two path checks was updated, so the other "spent months checking flat `{app}\<file>` paths" |

The lock/rollback class this change existed to remove is gone by construction: an update writes a NEW directory
and repoints a junction, so it never writes to a file anyone has open.

## The one task answered "no", deliberately

> *"Retire the process-killing stopgap once the new layout proves out, so updates no longer terminate the user's
> running desktop app."*

It stayed, and `Volt.iss` argues the case at the point of the decision: Restart Manager's graceful close cannot
touch either process — the connector is a self-contained .NET app holding `clrjit.dll` for its lifetime, the
TwinCAT worker is headless, and RM's async force-close **races the file copy**, so an update intermittently fails
with a sharing violation on `clrjit.dll`. `AppMutex` is worse: it blocks BEFORE `PrepareToInstall` runs. So
`CloseApplications=no` plus a deterministic stop in `PrepareToInstall` is the kept design — race-free and
identical on every machine.

Recorded rather than dropped: an open task that was answered "no" reads, a year later, exactly like an open task
nobody got to. The reason it is no longer a *stopgap* is that the versioned layout removed what it was
compensating for — it now stops processes because two of them genuinely cannot be closed any other way, not
because the installer is about to overwrite files in place.

## Stale in the original text, harmless

Tasks 1.1 and 1.5 enumerate `OPENCODE_CONFIG_DIR` among the paths recorded outside `{app}`. That variable no
longer exists — the whole opencode integration was removed on 2026-08-05, and the installer now sets exactly one
persistent env var, `PATH`. Fewer external paths to keep version-stable than the plan assumed.
