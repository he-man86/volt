## ADDED Requirements

### Requirement: a path is resolved once per runner
The runner SHALL resolve a given path at most once for its lifetime and SHALL serve later `get` and `set` calls of
the same path from that resolution, so that the cost of a call does not grow with the number of variables of the
POU. Values read and written, and the errors raised, SHALL be the same as with a resolution on every call.

#### Scenario: repeated reads of a global stay cheap
- **WHEN** a POU declares 400 variables and a host calls `get` on the same GVL member 10 000 times
- **THEN** the calls take under 20 ms in total and return the member's current value each time

#### Scenario: a cached path sees the program's writes
- **WHEN** a host reads `IO.x`, a scan assigns `IO.x := 5`, and the host reads `IO.x` again
- **THEN** the second read returns 5
