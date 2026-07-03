## ADDED Requirements

### Requirement: Graphical Execute boxes preserve their inline ST

The bridge SHALL preserve the inline ST of a CODESYS **Execute box** when materializing an FBD/CFC body — a PlcOpen block whose `fbdcalltype` addData is `execute` carries its statements in an `STCode` addData element, and the bridge SHALL NOT render that box as a bare `EXECUTE()` call and drop the code. The materialized body SHALL contain the box's actual ST (EN-guarded when the box has a wired EN input), so the LSP analyzes the real logic and a reader sees it.

A graphical body the bridge cannot yet round-trip losslessly (e.g. an Execute box whose ST it can read but
not yet reconstruct on push) SHALL be materialized **read-only** — the same treatment as CFC/SFC bodies — so
a `push` refuses it rather than writing back a lossy reconstruction. A body SHALL NEVER be both writable and
lossy.

#### Scenario: An Execute box's ST is materialized, not dropped
- **WHEN** a client fetches an FBD program whose network contains an Execute box holding
  `IF cmd THEN target := 0; END_IF`
- **THEN** the materialized body carries that ST (EN-guarded by the box's EN input), and contains no phantom
  `EXECUTE()` call

#### Scenario: A body with an unreconstructable Execute box is read-only
- **WHEN** the bridge can read an Execute box's ST but does not yet support reconstructing it on push
- **THEN** the materialized body is marked read-only and a `push` of it is refused, so the box's ST is never
  silently overwritten
