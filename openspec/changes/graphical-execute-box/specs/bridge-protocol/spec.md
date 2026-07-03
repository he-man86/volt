## ADDED Requirements

### Requirement: Graphical Execute boxes round-trip as a first-class VG construct

The bridge SHALL materialize a CODESYS **Execute box** — the standard "ST inside FBD/LD" element (a PlcOpen
block whose `fbdcalltype` addData is `execute`, carrying its statements in an `STCode` addData) — as a
first-class VG `EXECUTE … END_EXECUTE` block holding the box's Structured Text VERBATIM, never as a bare
`EXECUTE()` call that drops the ST. The box's enable SHALL use the ORDINARY VG EN machinery (a wire + `IF en
THEN … END_IF`), not a special form. On push, the bridge SHALL reconstruct the CODESYS Execute box from that
VG construct — `<block typeName="EXECUTE">` + `fbdcalltype=execute` + the verbatim `STCode` — so the ST
round-trips byte-for-byte and the box is created/edited, not read-only.

#### Scenario: An Execute box renders its inline ST, not a call
- **WHEN** a client fetches an FBD program whose network contains an Execute box holding
  `IF cmd THEN target := 0; END_IF`
- **THEN** the materialized body contains `EXECUTE` … `END_EXECUTE` with that ST verbatim (its comments and
  nested `IF` preserved), EN-guarded by the box's enable wire, and no bare `EXECUTE()` call

#### Scenario: Pushing the EXECUTE construct recreates the CODESYS Execute box
- **WHEN** a client pushes an FBD body containing `IF en THEN EXECUTE <st> END_EXECUTE END_IF`
- **THEN** the bridge creates a CODESYS Execute box (`<block typeName="EXECUTE">` + `fbdcalltype=execute` +
  `<STCode>`) wired to `en`, and fetching it back yields the same ST verbatim (a stable round-trip)

### Requirement: The LSP analyzes an Execute box's body as Structured Text, not simplified VG

The LSP's VG parser SHALL recognize the `EXECUTE … END_EXECUTE` block and SHALL NOT apply the simplified VG
statement grammar to its body — which is full ST (nested `IF`, comments, multi-statement) and would produce
spurious `VG_PARSE` diagnostics. The block's ST SHALL read as-is (no false diagnostics on valid code).

#### Scenario: Complex ST inside an Execute box does not produce VG parse errors
- **WHEN** the LSP analyzes an FBD body whose `EXECUTE` block contains multi-statement, commented ST
- **THEN** it emits no `VG_PARSE` (or `vg-undeclared`) diagnostics for that block, and the surrounding VG
  networks still analyze normally
