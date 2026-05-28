# Test fixtures

Real-world PLC source files used by the LSP quality / regression suite. **Not** part of the public package — these live alongside the source so tests can read them at runtime without bundling.

## What's here

### `tc3-basic/`

Mirrors the **TC3_PlcSample_BasicPlcElements** TwinCAT 3 sample project, pulled via `volt pull`. Layout reflects the IDE's folder tree 1:1 (`POUs/`, `DUTs/`, `GVLs/`, `Drives/`, `SumComparison/`). Coverage:

- 1 interface (`.itf`)
- 2 DUTs — struct + enum (`.dut`)
- 1 GVL (`.gvl`)
- 5 ST POUs — FBs, programs, functions (`.st`)
- 2 graphical (FBD) POUs (`.fbd`)
- 1 standalone function at the root (`.st`)

Picked because it ships with every TwinCAT 3 install (deterministic source) and exercises the four primary IEC 61131-3 declaration kinds plus graphical bodies.

## How to refresh

When the LSP gains new parser features or the TC3 sample updates, regenerate the corpus:

1. Open `TC3_PlcSample_BasicPlcElements` in TwinCAT 3.
2. Start the bridge: `BeckhoffBridge.exe` (or `volt bridge start`).
3. In a clean working dir: `volt init && volt pull`.
4. Copy every POU file (`.st`, `.gvl`, `.dut`, `.itf`, `.fbd`, `.ld`, `.sfc`, `.cfc`) preserving folder structure into `test-fixtures/tc3-basic/`. Exclude `.volt/`, `.claude/`, `.gitignore`.
5. Re-run `bun test` — snapshot diffs flag genuine parser-output changes (review, then `bun test -u` to accept).

The `.gitattributes` in this folder pins all fixture files to LF endings so snapshots stay stable across Windows / Unix checkouts.

## Why a real corpus

Every other test in this package uses inline string snippets (5–10 lines). They prove the parser handles the patterns we *thought* to write. The corpus proves it handles patterns TwinCAT engineers *actually* write — including pragma stacks, attribute clusters, and graphical-body placeholders the synthetic tests don't cover.
