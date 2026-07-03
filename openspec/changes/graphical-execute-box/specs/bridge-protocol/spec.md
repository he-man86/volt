## ADDED Requirements

### Requirement: Graphical Execute boxes are never materialized as a lossy phantom call

The bridge SHALL NOT render a CODESYS **Execute box** (a PlcOpen block whose `fbdcalltype` addData is
`execute`, carrying inline ST in an `STCode` addData) as a bare `EXECUTE()` call in a materialized FBD/CFC
body — doing so drops the box's ST and produces a phantom a push would write back over the real code. A body
the bridge cannot yet round-trip losslessly (one containing an Execute box) SHALL be materialized **read-only**
— an empty body plus the `@volt-graphical` marker, the same treatment as CFC/SFC — so the inline ST is edited
in the IDE and a `push` of the body is refused rather than silently overwriting it. A body SHALL NEVER be both
writable and lossy.

(Follow-up, not required by this change: materialize the Execute box's ST inline so the LSP analyzes it —
that needs the VG language + parser to represent inline-ST-in-a-network. Until then the ST lives in the IDE,
as CFC/SFC bodies already do.)

#### Scenario: An Execute box materializes read-only, never as a phantom call
- **WHEN** a client fetches an FBD program whose network contains an Execute box (`fbdcalltype = execute`)
- **THEN** the materialized body is read-only (the `@volt-graphical` marker, empty otherwise) and contains no
  phantom `EXECUTE()` call and no editable VG networks

#### Scenario: A push over an Execute-box body is refused
- **WHEN** a client pushes a body whose current IDE export contains an Execute box
- **THEN** the write is refused with a clear "read-only — edit it in the IDE" message, so the box's inline ST
  is never silently overwritten
