## ADDED Requirements

### Requirement: a path is resolved once per runner
The runner SHALL resolve a given path at most once for its lifetime and SHALL serve later `get` and `set` calls of
the same path from that resolution, so that the cost of a call does not grow with the number of variables of the
POU. Values read and written, and the errors raised, SHALL be the same as with a resolution on every call.

#### Scenario: a path through a record the program replaced
- **WHEN** a host reads `a.x`, a scan runs `a := b;` with `b.x` = 3, and the host reads `a.x`, then writes it
- **THEN** the read returns 3 and the write lands in `a`, not in `b`

#### Scenario: a path that does not resolve
- **WHEN** a host reads a path that names no variable, twice
- **THEN** both reads are refused by name

#### Scenario: a cached path sees the program's writes
- **WHEN** a host reads `IO.x`, a scan assigns `IO.x := 5`, and the host reads `IO.x` again
- **THEN** the second read returns 5
