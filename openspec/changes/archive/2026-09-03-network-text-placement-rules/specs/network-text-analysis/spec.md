## ADDED Requirements

### Requirement: Per-network metadata that cannot round-trip is diagnosed before the push

The LSP SHALL report a network body whose labels, titles or comments cannot survive a round trip, naming the
ROUND-TRIP consequence rather than the grammar rule — the engineer's symptom is a body that comes back different
from what they wrote, so that is what the message must describe.

A network carries exactly one label, one title and one comment. They are per-network metadata on `INetwork` on
BOTH vendors, not items in the statement list, while the text grammar admits them as ordinary statements.

**The push gate already refuses these** — measured 2026-09-03, pinned by `MetadataPlacementTests`: a second label
is rejected by the reader with a message naming it, and a label or comment after a statement fails the
canonical-form check. So this requirement RELOCATES an existing refusal to the keystroke rather than adding a
rule, and its messages SHOULD reuse the reader's wording instead of inventing a second phrasing for one fact.
The value is the feedback loop — finding out while typing instead of at push — which is ergonomics, not
correctness.

#### Scenario: A second label in one network is an error
- **WHEN** a network contains more than one label
- **THEN** the LSP reports `network-duplicate-label` as an error, because only one survives the write

#### Scenario: A label after a statement is reported as moving
- **WHEN** a label appears after a statement in a network
- **THEN** the LSP reports `network-label-not-first`, because its position is not represented and it returns at
  the network head on the next pull

#### Scenario: Multiple comment LINES are not reported
- **WHEN** a network contains several consecutive `//` lines before its first statement
- **THEN** the LSP reports nothing, because `Network.Comment` is multi-line: the lines are joined, round-trip
  exactly, and are one comment box in the IDE

### Requirement: An unresolved box is reported at the point of edit

The LSP SHALL report an operand of `???` as an error, raising at edit time the error the IDE would raise at build
time.

CODESYS writes `???` into a box whose instance is unresolved. It is the vendor's own marker for a box that will
not compile, and it reaches the workspace verbatim — five in one surveyed project, one of them an assignment
target. It is also why network text has no `?` token of its own: a sigil for the unconnected pin was tried and
withdrawn precisely because `???` was already content.

#### Scenario: A `???` operand is an error
- **WHEN** an operand in a network body is `???`
- **THEN** the LSP reports `NETWORK_UNRESOLVED_BOX` as an error

### Requirement: The empty slot parses and is not a syntax error

The LSP SHALL parse every empty-operand form without reporting a syntax error, and SHALL surface it as a hint at
most.

A pin connected to nothing is written as nothing, in whichever operand position it occupies — `( * iRPM * 6)`,
`ctu(CU := a, RESET := , PV := )`, `f(, a)`, `coil := ;`, a bare `;`. An unwired pin is ordinary in a live
project: 110 networks in one surveyed, and half the ladders in it have one.

#### Scenario: An unwired pin parses
- **WHEN** a network body contains an empty operand slot in any position
- **THEN** the LSP parses the body and reports no syntax error for the empty slot

### Requirement: A reserved wire prefix is NOT reported on its own

The LSP SHALL NOT warn merely because a `LET` binds a name matching `g<n>`, `i<n>` or `en<n>`.

`g<n>` is a fan-out wire, `i<n>` an opaque leaf, `en<n>` an enable echo, and the reader honours the PREFIX rather
than counting uses. The original requirement here asked for a warning on any hand-written binding of one — but
**the LSP cannot tell hand-written from pulled, because Volt's own writer emits exactly these names.** Measured
2026-09-03 across the corpus: 247 `LET g<n>`, 196 `LET en<n>` and 33 `LET i<n>` bindings, all Volt's own output.
The warning would fire 476 times on correct, round-tripping content.

The narrower case that IS ambiguous — a reserved name that also names a declared variable, where the reader
conflates the two — is not reachable from Volt's output either: the writer renames a colliding wire rather than
emitting one. The corpus carries a single `i2` declaration, in a textual body.

#### Scenario: A pulled fan-out wire is not reported
- **WHEN** a graphical body contains `LET g0 := (a AND b);` and a statement reading `g0`
- **THEN** the LSP reports nothing, because that is what a pulled fan-out looks like

### Requirement: A positional call may stand alone as a statement

The LSP SHALL accept a positional call as a statement in its own right, and SHALL NOT report it as a malformed
function-block invocation or as a call missing its named arguments.

A box whose output goes nowhere is a statement — `MOVE(g0, iDec);`, 34 networks in one surveyed project. Any rule
assuming a bare call is an FB-instance invocation, or that a missing `PIN :=` is a mistake, is wrong.

#### Scenario: A standalone positional call is accepted
- **WHEN** a network body contains a positional call as a statement with no assignment target
- **THEN** the LSP accepts it and does not report a missing named-argument diagnostic
