# Fixture census — group the questions by what they ask, and find the ones nobody asked

## Why

**The fixture set grew by accretion and nobody has ever looked at it as a whole.**

1,002 fixtures in 55 categories. The categories are sized 192 down to 2, and a third of them are named after the
BATCH THEY ARRIVED IN rather than the thing they ask about: `check-coverage`, `check-coverage-two` … through
`check-coverage-six`; `cross-object`, `-two`, `-three`, `-four`; `corpus-types`, `corpus-pragmas`,
`corpus-operators`, `corpus-addresses`, `corpus-standard`. Those are provenance labels. **There is no axis along
which anyone can ask "is this topic finished?"**, because the groups are not topics.

That is not a tidiness complaint. It is why the gaps below were invisible.

## The evidence, all from one session (2026-09-18)

**Four fixtures asked whether `-x` and `NOT x` are errors on a non-number.** The answers looked like a rule:
`-STRING` → INT, `-BOOL` → INT, `-TIME` → DINT. Three points. Writing thirty-five more probes — every elementary
type, one at a time — produced a DIFFERENT rule and two product bugs:

- `-SINT` and `-BYTE` are **INT**, not SINT/BYTE: an 8-bit operand widens. Nothing had asked an 8-bit type.
- `-ULINT` is **LINT**. The code answered `UNKNOWN` with the comment *"64-bit unsigned was not measured: silence,
  not a guess"* — and a unit test asserted that silence. The silence was itself a guess.
- `NOT WORD` is **UINT**, `NOT TIME` is **UDINT**. The rule was implemented for signed integers only, because the
  one fixture that existed used a signed integer.

Four fixtures had covered the topic by the only standard available: *somebody thought of them*. The topic needed
thirty-nine.

**Forty-nine fixtures had never reached a compiler at all.** They declared nothing PLC_PRG could read, the
recorder filtered them out, and they sat rated `unasked` as though the question were open. It was never put. Among
the answers once they were: an INTERFACE with a VAR section **compiles**; a declared name unlike the POU's is **not
an error**; `refuse_var_temp_struct` — whose name and feature line both read as a vendor refusal — **compiles**.

**`__VECTOR[4] OF REAL` had neither bounds nor open dims** for as long as it has existed, because no fixture could
name an element of it.

Each of these was found by accident, while doing something else. That is the process this change replaces.

## What this change is

A census, then a fill. **Not a rewrite** — no fixture is deleted for being redundant, and the redundancy is not the
problem. The two deliverables:

1. **A topic tree.** Every fixture is placed under `topic / subtopic / case`, where a topic is a thing the language
   has (an operator, a declaration form, a call shape, a conversion) and a subtopic is a dimension that thing
   varies along (operand type, width, signedness, section kind, vendor). The tree is derived from the LANGUAGE, not
   from the fixtures — so a cell with no fixture in it is visible by construction.
2. **The empty cells, filled or refused in writing.** Every cell gets a fixture and a recording, or an entry saying
   why the question cannot be put. `unasked: 0` already holds and must keep holding.

The `uop_*` family is the shape to copy: a helper that generates one fixture per cell, each assigning into a
deliberately wrong destination so the compiler has to NAME what it inferred, and a header comment carrying the
whole recorded table.

## What this is not

- **Not "more tests for coverage's sake".** The unary family found two real bugs in thirty-five probes. The bet is
  that the rate is similar elsewhere; if a topic's cells all come back confirming what we already do, that topic is
  finished and we will know it for the first time.
- **Not a refactor of the 55 categories.** Renaming the files is cheap and can follow; the tree can be a derived
  index over the fixtures we have. Moving code is not the point and would obscure the diff.
- **Not blocked on, and does not block, D6** (the METHOD/ACTION bodies). They are independent.

## The standard this sets

> **A topic is covered when the tree says every cell has an answer — not when someone cannot think of another case.**

The current standard is the second one, and this session is what it costs.
