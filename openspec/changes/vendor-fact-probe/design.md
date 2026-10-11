## Design gate: row shape, vendor core, `[PROBE: id]` marker

**Target.** Each fact the proposal lists becomes one table row. Neither the TS driver nor a vendor core gets a
fact-specific branch.

**Choice: a row is a scenario plus reads, written in a small fixed vocabulary that each vendor core implements once.**

```ts
type Row = {
  id: string                    // kebab, = the [PROBE: id] marker
  dialect: string[]             // DIALECT ids it backs: ["C2e"]
  vendors: { codesys?: true | { absent: string }, twincat?: true | { absent: string } }  // absent = refused by name
  fixture: "codesys" | "twincat13" | "twincat14"
  steps: Step[]                 // create | setText | rename | move | delete | build | reload | invoke
  reads: Read[]                 // after a named step: { at: stepIndex, key, op, args }
}
// Step / Read ops (closed set): create{kind,name,parent,text?}  setText  rename  move  delete  build  reload
//   invoke{path,args}  (a reflection / COM member call, e.g. the task config's PerformWithWriteableCopy)
//   read: outcome (accepted | refused + message verbatim)  member{path} (reflection / COM read, null = absent)
//         class  guid  children  signature  diagnostics{guid,position}  process{exe|assembly|automation}
```

**Vendor core interface** (the same in both): `create(row) -> handles` runs the steps and records each step's
outcome; `read(handles, read) -> JSON`; `cleanup(handles)` deletes what was created, whether or not the reads
passed. CODESYS is `vendor-facts.codesys.py` (IronPython, imports `voltprobe`), started through `ide.ps1 -RunScript`.
TwinCAT is `vendor-facts.twincat.ps1` (COM on the instance's XAE). The driver passes all rows in one JSON file and
gets one JSON result back, so there is one IDE session per vendor.

**Every listed fact fits.** Kind source and C2g/C2h are `create`+`setText`/`build`/`reload`, then `member`/`class`/`signature`.
C2k and the duplicate method are `create` → `outcome`. C2e is `setText` → `guid`/`member`. C2n is `setText`/`rename`/`move` → `guid`/`class`.
D34 and empty folders are `create`/`delete` → `outcome`/`children`. The tasks group (C19b, KindOfTask, call list, call
comment) is `invoke` → `member`. Accessors use `member`. The project container, D35 and C24 use `member`/`class`.
D37–D39 use `member`, where a null answer records the ABSENCE. C27 is `build` → `diagnostics`. V1/V4/V5 use `process`.

**Rejected:**
- *One named reader function per fact.* That is the 54 deleted probes again, kept in one file.
- *A bridge op per fact.* It adds dev-only words to the wire. The facts also sit below the seam, in reflection,
  session services and assembly versions, where the wire cannot reach.
- *Run everything over the pipe.* The same reason: the pipe sees only what the driver already exposes.

**Refused by name (in the table as `absent`, or out of it):** the TwinCAT warning list stays out of the table. The
`probe-tc-project-settings-gui.ps1` GUI half is not re-measurable headless, so the row records the automation absence
instead. Corpus censuses (`accessor-census`) are not vendor facts, and N-rows wait for the LD/FBD design.
A fact one vendor lacks is `{ absent: "<reason>" }` and lands in the snapshot as `"absent: <reason>"`, never a guess.

**Snapshot.** `{ "<fact-id>": { "<read key>": value } }` with sorted keys and no timestamps or pids. Process facts keep
versions, since a version change IS a finding.

**Marker.** It goes in the row's id cell, after the bold id: `| **C2e** [PROBE: dut-subtype-in-place] | …`. A row may
carry several. The spelling follows the existing `[RETRACTED -> X]` marker. The gate's regex is
`\[PROBE: ([a-z0-9-]+)\]`. Both directions are checked: marker → row, and row.dialect → an existing id.

**Migration.** 0.2 marks the rows. 1.1 adds the gate, red. 2.x recovers each probe's logic from `b2496efb4b` as a
row. 4.1: after bridge-refusal-review, `RefusedNamesMatchTheLogsTests` reads the refused words from the CODESYS and
TwinCAT snapshots (a `refused-names` row with one `outcome` read per word), and the six logs and
`probe-member-name-refusal.ts` are deleted.
