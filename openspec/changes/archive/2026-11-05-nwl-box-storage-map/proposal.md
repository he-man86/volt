## Why

Owner, 2026-11-03: "we need the exact storgra format and options for th eboxes and how we can transpile it to our lanuge". The design rule is to fit NWL as exactly as possible. Earlier network-text decisions started from what a corpus holds. This change maps what NWL can store on a box instead, from the vendor's assemblies, its editor and live measurements, and what a pull does with each state.

## What changes

- **The map** (`design.md`): one row per `BoxTreeBox` member and option, per box kind (FUNCTION, FB, PROGRAM, operator, comparison, Execute), with what it does to the picture, the generated code and the run, and what a pull does with it today.
- **A recording and a live fixture**: one recorded row per stored state (`test/fixtures/nwl-schema/box-states.3.5.21.40.json`), and an IDE-authored project holding the states a live test pulls and runs.
- **Tests**: a pull that loses a state fails, offline over every row and live over the fixture's.
- **Bugs found on the way are fixed, each test-first in its own commit**: the pull of a stored state the IDE does not build, a pushed PROGRAM box with VAR_OUTPUT, and a pushed Execute box that did not run.

## Non-goals

No language change. The map and its gap list feed the parked decision on a box's main output (`=> Q` against `.NAME`), which the owner decides with Sim-Assist; this change recommends no spelling. TwinCAT is not started: each row says what the committed archives show, or that it is unmeasured.
