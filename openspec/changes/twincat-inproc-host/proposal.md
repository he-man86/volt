## Why

The owner expected TwinCAT LD/FBD to work like CODESYS: one graphical writer over the vendor's own NWL object model, no
PLCopen. It does not. TwinCAT reads the `.TcPOU` archive text, edits it in place for value-only changes
(`TcNetworkWriter`, 1285 lines) and builds every new structure through a PLCopen import (`TcPlcOpenWriter`, 503 lines:
create, and the one-network rebuild ld-fbd-coverage splices back). The owner's goal was NO PLCopen write. The PLCopen
route also forces refusals and reshapes CODESYS does not have:
- **Create only:** an Execute box, an output pin wired to a variable (C20), an N-destination jump, a single-consumer
  branch point (D30).
- **Refused before the import:** an assign below the top level, PARALLEL, a leaf-fed split, a box result `=> v`,
  `SUPER^`, a negated input.
- **Edit:** a network holding several rungs (D25), an item-count change, and more.
- **Measured live 2026-10-16:** a fan-out comes back reshaped, the branch point gone, with `{OutputParam…}` importer
  leftovers.

Investigated 2026-10-16 (live, TcXaeShell 15 x86, fixture 13). The evidence is in `evidence/`, and the research is in
`research.md`.

## Findings

- **The API is there.** TwinCAT's `Core.dll` has the same `SystemInstances.ObjectMgr` / `Engine`, `IObjectManager.
  GetObjectToModify` / `SetObject` and `IFrame.OpenEditorView` the CODESYS in-proc driver uses. The PLC is itself a
  VSPackage, so the 3S framework runs inside the shell. N12's wall (the archive format) does not apply in-proc.
- **The new wall is loading code into the shell.**
  - No per-user extension root exists (no `UserExtensionsRootFolder`).
  - The shell's `VSIXInstaller` cannot target it (`0x80070490`).
  - The supported route is a per-machine VSPackage in `Common7\IDE\Extensions`, which needs **admin**. That is how
    Beckhoff ships its own add-ons.
  - The only per-user hack, an HKCU `15.0_IsoShell_Config` package plus autoload, was refused by the session's
    permission policy and not run.
- **`CodesysNetworkWriter` does not run unchanged.** TwinCAT's NWL plugin (3.5.13.30) has every mutator, but only
  parameterless constructors, so the writer would construct then set. That is about 30 lines, and it also works on
  SP21. N1's "port unchanged" is false at this level.
- **Hand-built archives (alternative B) work with a reload gate.** A single-consumer branch point built by hand:
  - **Attempt 1** broke an unwritten serializer rule (`cet` on a mixed list). It was accepted live, saved verbatim, and
    then could not be loaded after a reload (C2i class).
  - **Attempt 2**, following the vendor's rule, loads, builds with 0 errors, opens, and pulls the same text after a
    reload, in LD and FBD.
  - `BoxTreeParallel` has no vendor template (0 in 155 archives).

## Options (owner decides)

- **A — in-proc TcXaeShell host (the CODESYS approach).**
  - **Deletes** about 2,700–3,000 product lines: `TcPlcOpenWriter`, `TcNetworkWriter`, `TcNetworkReader`, most of
    `TcArchive` / `TcUnmeasured`, the graphical half of `TcItemArchive`, `ValidateSource`, and every PLCopen-only
    refusal.
  - **Shares** CodesysNetworkReader/Writer, which move to a vendor-neutral NWL project.
  - **Adds** a net48 x86 VSPackage hosting the pipe in-proc, a per-machine (**admin**) install, and possibly the
    whole TwinCAT driver in-proc, which deletes the worker.
  - **Risks:** admin install; TcXaeShell64 (4026) needs a second registration; shell updates; an in-proc fault crashes
    the IDE; steps (b)–(d) are unmeasured.
- **B — hand-built archives with a save + reload + re-read gate.**
  - **Deletes** about 900 lines on the create and splice side.
  - **Risks:** unwritten serializer rules, C2i crashes, no Parallel template, and a slow reload per push.
- **C — keep today's route** with its refusals and reshapes.

## Decision (owner, 2026-10-16): C — PLCopen stays on TwinCAT

"This is not how TwinCAT intended it." Beckhoff's door for an outside tool is the Automation Interface (COM). For
graphical code that door is `PlcOpenImport` / export. An in-proc TcXaeShell extension is how Beckhoff ships its own
add-ons, and it needs an admin install per machine. Hand-built archives are validated by nothing on load and can crash
the IDE. Both alternatives were measured (proposal "Findings", research.md) and rejected, so PLCopen on TwinCAT is an
accepted vendor difference (wire-divergence rule: two measured alternatives + owner OK). The CODESYS side keeps its one
in-proc writer.

What remains worth doing, within the PLCopen route:
- correct the false parity claims (task 1.1);
- per refused shape, check whether PLCopen can express it after all, and keep refusing only what it measurably cannot.

## Decisions that were open (superseded by C above)

1. **Admin:** is a one-time admin install of a TcXaeShell extension acceptable for TwinCAT users? They already install
   TwinCAT as admin. If not, only B or C remain.
2. **Measurement:** if A is wanted, allow the measurement registration (HKCU `…_Config` package plus autoload, off
   unless an env var is set, removed afterwards) or an admin install on the dev machine, so (b)–(d) run end to end.
   Shapes, edits and checks:
   - LD + FBD, a single-consumer branch, an unconnected pin, a parallel;
   - create, edit, rebuild;
   - save/reopen, build 0 errors, the editor opens it, pull returns the same text.
3. **Stopgap:** whether B is acceptable for the shapes PLCopen refuses.

Not implemented: a spec only, after ld-fbd-coverage. Docs that claim a parity that isn't there (DIALECT N1,
`TcNetworkReader.cs:14-17`, `BeckhoffDriver.Content.cs:437-442`, ARCHITECTURE.md:123, volt-web `content.js:56`, D30,
the `roundtrip.test.ts` multicoil comment) are corrected in this change's first step.

## Impact

`packages/volt-cli/src/Volt.Ide.Twincat` (graphical write and read), an installer step if A is chosen, and DIALECT /
ARCHITECTURE.
