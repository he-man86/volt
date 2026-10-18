Requires: `ld-fbd-coverage` (archived 2026-10-17) and `multi-application-tree` archived. Spec only until then — do not start.

Order (owner, 2026-10-17): **behind the wire first** — `Volt.Engine`, `Volt.Ide.Codesys`, `Volt.Ide.Twincat` (and their
tests), with the wire as it stands after `multi-application-tree` as the fixed reference (3.3: byte-identical before/after).
The rework never changes the wire; a wire defect it finds becomes its own small change. The front of the wire (`Volt.Cli`,
the connector, volt-control, volt-vscode) follows afterwards, against the same wire.

**The wire itself is reviewed critically first** (owner, 2026-10-17: "agents tend to add logic to solve edge cases that are
not needed"). Step 1.1 includes a wire audit: every field, op, error code and rule in `Volt.Contracts/Wire` — who reads it,
which measured case needs it, what breaks without it. Anything added for an edge case that is not measured or not needed
is listed for deletion. And the shape: one way to say each fact, consistent names, no field that only
mirrors how the code happened to be built — the interface as it should be, not as it grew. Stripped of every legacy
or unstructured field (owner): a leftover of a removed design, a loose string where a structure belongs, a bag of
optional values whose combinations mean different things. The owner decides the list in 1.2; the deletions land as one small wire change BEFORE the
behind-the-wire refactor, so the fixed reference is the simplified wire.

**Find what an outside client finds** (owner, 2026-10-18). PLC Assist, writing a second client against the docs, found
seven defects our gates missed (strict members on push only; case-insensitive paths on push only; `unreadable` without a
kind; a protocol number that never moved; a move onto an existing path; an unsaved TwinCAT window with no row; an LSP
stack overflow). The pattern: a rule enforced at several call sites, one of which drifted; and tests that only ever pair
a client and a bridge from the same commit. The audit and the rework add, as standing practice:
- **Foreign-client review**: an agent given ONLY `docs/wire.html` and the OpenRPC document, no repo context, writes a
  minimal client and reports every inconsistency between the contract, the read side and the write side. Run in 1.1,
  and as a step of every change that touches `Volt.Contracts/Wire` (the change workflow gets it).
- **One place per rule, gated**: every wire rule (path comparer, wire-name minter, strict request reader, protocol number
  beside the schema pin) has one implementation and a `Volt.Repo.Gates` test that a new call site cannot bypass it. The
  audit lists every rule that lives in more than one place.
- **A mixed-version e2e cell**: the current CLI against the previous release's bridge (and the reverse), which must be
  refused by name before any op, never misread.
- **Size and fuzz inputs for the LSP**: generated deep and long inputs (nesting, flat chains, long files) in the suite,
  so a crash on input nobody typed is found here first.

## 1. Map

- [ ] 1.1 Per project: what it owns (ARCHITECTURE.md, README) vs what its code does; list misplaced code, duplicated
      logic between the hosts, and cross-project leaks. Merge with the 2026-10-16 simplify reviews (what is left).
      Open question for 1.2 (owner, 2026-10-17, not decided): the translation model → NWL nodes is done twice, once per
      driver (`CodesysNetworkWriter` 875 lines; `TcArchiveBuilder` + `TcNetworkWriter` 1660) although the NWL model is
      identical on both vendors (DIALECT N1). NWL is the CODESYS family's format, not vendor-neutral — a future vendor
      (Siemens, Rockwell) has no NWL — so the Engine core stays at `NetworkModel`. Proposal: one shared CODESYS-family NWL
      layer (model → NWL description) used by both drivers, each driver only placing it (live objects / XmlArchive).
- [ ] 1.2 Owner review of the map: which projects are refactored, which (if any) reimplemented.

## 2. Find (parallel per project, each finding adversarially verified)

- [ ] 2.1 Legacy: code/comments/docs of removed designs and old formats.
- [ ] 2.2 Hidden bugs: masking fallbacks, silent defaults, untested branches — a failing test per bug.
- [ ] 2.3 Hidden features: behaviour no doc or test states — owner decides document+test or delete.

## 3. Rework (project by project, test-first)

- [ ] 3.1 Move misplaced code to its owning project; delete legacy; fix each bug behind its test.
- [ ] 3.2 Reimplement only the projects the owner approved in 1.2, behind the same tests.
- [ ] 3.3 Every step: full C# suites + TS e2e on both vendors; the wire byte-identical before/after.

## 4. Close

- [ ] 4.1 ARCHITECTURE.md / DIALECT.md / READMEs match the code; final placement review; archive.
