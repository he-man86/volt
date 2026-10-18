Requires: `ld-fbd-coverage` and `multi-application-tree` — both archived; this change may start.

**Goal (owner, 2026-10-18): a new vendor is one IDE host** (proposal, spec). Every step below is judged by it: code is
placed so a vendor outside the CODESYS family (Siemens, Rockwell) implements the `Ide/` contract in its own host and
nothing above that contract learns its name. Shared code goes to `Volt.Engine` only if it names no CODESYS-family fact;
what both current hosts share as a family (NWL, DIALECT N1, the object model) goes to the family layer
`Volt.Ide.CodesysFamily` (owner default 2026-10-18: a project of its own, built for net48 and the x86 worker).

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
a client and a bridge from the same commit. **The premise behind that gap is false** (owner, 2026-10-18): the wire is
not an internal seam between our CLI and our bridge — PLC Assist ships the bridge bundles and drives the pipe itself, so
the bridge + wire is a PUBLIC API with a second client. Every review step (1.1, 2.x) judges the bridge as that API: what
does it do for a request our CLI never sends (other case, other order, a taken name, an old protocol, an IDE state the
CLI happens to avoid)? A rule that holds only because our CLI is polite is a finding. The audit and the rework add, as
standing practice:
- **A contract suite driven by the OpenRPC document, not by our CLI**: every op and member the schema allows,
  including the awkward combinations, sent straight to the pipe against both live bridges; it asserts the response
  shape and the error code `wire.html` promises (an IDE state is never `INTERNAL_ERROR`). Built in 1.3 from the audit,
  BEFORE the rework, so it is the oracle 3.3 compares against; run in every e2e cell.
- **Foreign-client review**: an agent given ONLY `docs/wire.html` and the OpenRPC document, no repo context, writes a
  minimal client and reports every inconsistency between the contract, the read side and the write side. Run in 1.1,
  and as a step of every change that touches `Volt.Contracts/Wire` (the change workflow gets it).
- **One place per rule, gated**: every wire rule (path comparer, wire-name minter, strict request reader, protocol number
  beside the schema pin) has one implementation and a `Volt.Repo.Gates` test that a new call site cannot bypass it. The
  audit lists every rule that lives in more than one place.
- **A mixed-version e2e cell**: the current CLI against the previous release's bridge (and the reverse), which must be
  refused by name before any op, never misread.
- (The LSP size and fuzz inputs are `volt-lsp-iec`, outside this change: openspec `lsp-size-fuzz`.)

## 1. Map

- [ ] 1.0 LOC baseline (owner, 2026-10-18), measured at the commit the rework starts from: per project in `src/` and
      `test/`, C# lines split code / comment / blank (bin, obj excluded), plus `scripts/`. Recorded here; 4.1 measures
      the same way and reports before → after per project.

- [ ] 1.1 Per project: what it owns (ARCHITECTURE.md, README) vs what its code does; list misplaced code, duplicated
      logic between the hosts, and cross-project leaks. Merge with the 2026-10-16 simplify reviews (what is left).
      Open question for 1.2 (owner, 2026-10-17, not decided): the translation model → NWL nodes is done twice, once per
      driver (`CodesysNetworkWriter` 875 lines; `TcArchiveBuilder` + `TcNetworkWriter` 1660) although the NWL model is
      identical on both vendors (DIALECT N1). NWL is the CODESYS family's format, not vendor-neutral — a future vendor
      (Siemens, Rockwell) has no NWL — so the Engine core stays at `NetworkModel`. Proposal: one shared CODESYS-family NWL
      layer (model → NWL description) used by both drivers, each driver only placing it (live objects / XmlArchive).
- [ ] 1.1a Vendor-neutrality audit of the two contracts a new vendor meets (goal): the WIRE — every fact that is
      CODESYS-family (item kinds `.pou/.dut/.gvl/.visualization/.task/.device`, the path shape, `IMPLEMENTATION LD/FBD`
      network text) and how a Siemens (FB/FC/DB/UDT/OB) or Rockwell (programs/routines/tags) project would say its own;
      and the `Ide/` CONTRACT (`ICodeStore`, `IProjectTree`, …) judged by "could a non-CODESYS host implement this?"
      (folders, POU children, get/set properties, NWL bodies). Output: a list for 1.2, not a fix.
- [ ] 1.1b Foreign-client review (above): ONLY `docs/wire.html` + the OpenRPC document, no repo context.
- [ ] 1.2 Owner review of the map: which projects are refactored, which (if any) reimplemented.

- [ ] 1.3 Safety net before any rework, from the 1.2 decisions:
      - the OpenRPC-driven contract suite (above), which also RECORDS a wire transcript per vendor fixture — the
        byte-identical reference 3.3 compares against;
      - one implementation + one `Volt.Repo.Gates` test per wire rule (path comparer, wire-name minter, strict request
        reader, protocol number beside the schema pin, error-code mapping);
      - the mixed-version e2e cell (current CLI ↔ previous release's bridge, refused by name before any op);
      - the new-vendor proof: a `Volt.Repo.Gates` test that `Volt.Engine` above `Ide/`, `Volt.Contracts` and `Volt.Cli`
        name no `Codesys`/`Twincat`/`Beckhoff`/`Nwl` symbol (red now is expected: it lists the work), and a minimal
        third test vendor OUTSIDE the CODESYS family (no NWL, its own object model) that passes the transport suite.

## 2. Find (parallel per project, each finding adversarially verified)

- [ ] 2.1 Legacy: code/comments/docs of removed designs and old formats.
- [ ] 2.2 Hidden bugs: masking fallbacks, silent defaults, untested branches — a failing test per bug.
- [ ] 2.3 Hidden features: behaviour no doc or test states — owner decides document+test or delete.
- [ ] 2.4 Public-API lens (every project the wire reaches): each request the schema allows but our CLI never sends —
      what the bridge does with it; a wrong code, a lost write or an `INTERNAL_ERROR` for an IDE state is a bug (2.2).

## 3. Rework (project by project, test-first)

- [ ] 3.1 Move misplaced code to its owning project (CODESYS-family code shared by both hosts → `Volt.Ide.CodesysFamily`,
      starting with the one model → NWL translation); delete legacy; fix each bug behind its test.
- [ ] 3.2 Reimplement only the projects the owner approved in 1.2, behind the same tests.
- [ ] 3.3 Every step: full C# suites + TS e2e on both vendors + the contract suite; the wire transcript byte-identical
      to 1.3's recording (a 1.2 wire deletion re-records it once, in its own change, before the rework).
- [ ] 3.4 The new-vendor gate from 1.3 green; the third test vendor still passes.

## 4. Close

- [ ] 4.0 LOC after: the 1.0 measurement again, before → after per project (code / comment / blank).
- [ ] 4.0a `ARCHITECTURE.md` gains "Adding a vendor": exactly what a host implements (the `Ide/` contract), and the
      registration points above the wire a vendor still needs — the connector's launch, the installer payload, the LSP
      dialect — which are the front-of-wire phase's work, not this change's.
- [ ] 4.1 ARCHITECTURE.md / DIALECT.md / READMEs match the code; final placement review; archive.
