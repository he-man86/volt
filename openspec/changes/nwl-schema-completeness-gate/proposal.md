## Why

Owner, 2026-10-31: "this project is just 1 project … we need to iron out all edgecases … pretty much a 1 to 1
transpiler from NWL". Every network-text check so far starts from the customer corpus, so a shape that the corpus
lacks is unchecked. Today's work found several such shapes: the rail, marks on pins and coils, an unnamed marked pin,
and a negated output. The check has to start from NWL itself. Designed jointly with Sim-Assist.

## What changes

- **Schema census.** Read every NWL node class, field and flag value, and every slot where each can occur, from the
  CODESYS NWL assembly (MetadataLoadContext, as DIALECT N1/N12 do). This is a generated table with no hand list.
- **Generated shapes.** Each node class × each slot it can occupy × each single flag, then pairwise flag stacks and
  nesting depth ≤ 2. What is cut is logged, so the gate never claims coverage it lacks.
- **Gate, both directions.**
  - Model → text → model, which finds a missing spelling.
  - Text → model → text over every grammar production, each instantiated once, which finds a second spelling.
  - A combination that has no spelling and no named refusal fails.
- **CODESYS.** Each generated shape is stored, built and drawn once on live CODESYS (sampled per class/slot/flag),
  and the recording is committed.
- **Shared fixture.** The generated shapes are exported as a versioned fixture file (the text plus
  class/slot/flags) at a stable path. Sim-Assist runs its editor check over the same list (text → model → layout →
  no-op edit → identical text).
- **Second source.** Sim-Assist's editor test texts (several hundred) are imported as an extra input to the gate.

## Non-goals

TwinCAT live (offline only for now); SFC/CFC/IL.
