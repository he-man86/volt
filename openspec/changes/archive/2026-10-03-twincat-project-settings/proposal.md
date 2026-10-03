## Why

**A warning the engineer disabled in TwinCAT is still reported by Volt's LSP.** On CODESYS the bridge materializes the
project's compiler settings as a read-only `Project Settings.projectsettings` descriptor
(`Volt.Ide.Codesys/Ide/CodesysObjectModel.Descriptors.cs`: "Disabled warnings", "Warnings as errors", …), and the LSP
reads it (`src/analysis/config.ts` `projectDiagnosticsFrom`, wired in `server.ts` / `workspace-refs.ts`): pro2193
disables C0371, so the LSP's VAR_IN_OUT external-access warning is off there. The TwinCAT bridge materializes no such
descriptor (twincat-project14 has none), so on TwinCAT every disabled warning is reported anyway — an LSP-only message,
i.e. a false positive by the parity rule. Owner, 2026-10-02: "we don't have this on TC yet".

## What Changes

- **Measure** where TwinCAT XAE keeps the PLC project's compiler settings (disabled warnings, warnings as errors, and the
  other rows the CODESYS descriptor carries): the `.plcproj` XML, the automation interface (ITcPlcIECProject /
  project properties), or the 3S settings inside the project — on a fixture copy, by changing each setting in the IDE and
  diffing what changes. Record the vendor fact in DIALECT.md.
- **The TwinCAT driver materializes the same descriptor** — same file name, same row format, same read-only kind — from
  the vendor's own stored settings (no guessing: a row whose source is not found is omitted and named in DIALECT.md, not
  defaulted). The LSP needs no change: it is vendor-blind and already reads the descriptor.
- **Parity**: the same settings on both vendors give byte-identical descriptor text (the wire is the parity boundary).

## Impact

- `Volt.Ide.Twincat` (driver content/descriptors), DIALECT.md, the C# tests (FakeIde / TwinCAT doubles), the TS e2e
  parity suite (a TwinCAT project with a disabled warning), and the twincat-project14 corpus re-pulled if it carries a
  disabled warning.

## Close-out (2026-10-03)

Built: the TwinCAT driver materializes `Project Settings.projectsettings` through the engine's shared format — the
disabled warnings from the saved `.plcproj`, Replace constants / Max compiler warnings / Project defines from the
automation interface, the four rows without a TwinCAT source omitted (D37–D39). Verified live (tasks 3.1–3.4): a
warning disabled in XAE is pulled and the LSP stops reporting it; all four rows both vendors source are byte-identical
for the same settings (the cross-driver facts assert them). Named gap (D37, measured): after TwinCAT fails to save the
clearing of the LAST disabled warning, the open session's build follows the page while the descriptor reads the stale
file, until the next warning save or a reload — no other source exists. The Impact line's "TS e2e parity suite" was
not added as a separate e2e: the live pull (3.1), the live probes (3.4) and the linked parity facts in both driver
suites cover it; twincat-project14 carries no disabled warning, so no corpus re-pull was needed.
