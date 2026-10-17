Owner 2026-10-16: no in-proc host; the direction is a native-format writer (proposal "Decision"). Section 2 starts
NOW (owner: "a nice task for tonight") in its own worktree, as NEW code beside today's writers — it must not edit
`TcNetworkWriter`/`TcNetworkReader`/`TcPlcOpenWriter` (ld-fbd-coverage is rewriting them). Section 3 (the swap) waits
for ld-fbd-coverage to archive and the owner's OK.

## 1. Correct the docs

- [x] 1.1 Fix the false parity claims: DIALECT N1 ("port unchanged": the constructors differ), `TcNetworkReader.cs:14-17`,
      `BeckhoffDriver.Content.cs:437-442`, ARCHITECTURE.md:123, volt-web `content.js:56`, D30, and the roundtrip
      multicoil comment.

## 2. Measure the native-format writer

- [x] 2.1 Identity gate: a writer from the network model to `<NWL><XmlArchive>` that reproduces EVERY archive in the
      fixtures and corpora byte for byte. Any mismatch is a rule to learn, never a tolerance.
- [x] 2.2 Templates: draw every node type in the TwinCAT editor (LD and FBD, a parallel, a single-consumer branch, an
      unconnected pin, an Execute box, a pin wired to a variable, a negated input) and capture them as fixtures. Never
      hand-write one.
- [x] 2.3 Live: create, edit and rebuild each shape through `ImplementationXml` / `DocumentXml`. Then save, reload,
      build with 0 errors, open the editor, and pull the same text. Also measure the cost of one reload.
- [x] 2.4 Report to the owner: which PLCopen refusals disappear, what stays, and the cost. The owner decides the swap.

## 3. Swap (only after the owner's OK)

- [x] 3.1 Route TwinCAT create and rebuild through the native writer, and delete `TcPlcOpenWriter`, the
      splice/renumber/grouping code and the PLCopen-only refusals. Run e2e on both vendors.

Done 2026-10-16/17 on branch `twincat-native-writer` (overnight, owner's instruction "plan this out and implement over
night"; not pushed, not merged). Results: `design.md`, "Results". Section 3 was done on the branch with the owner's
overnight go-ahead; merging it waits for ld-fbd-coverage 2R (rebase notes in `design.md`) and the owner's review.
Deviations, each recorded in `design.md`: 2.2's templates were authored through TwinCAT's own PLCopen IMPORT (an
authoring tool whose output archive TwinCAT serialized) rather than by drawing — synthetic GUI clicks misfire; the
PARALLEL template does not exist because the importer lowers parallel contacts to an OR box, so PARALLEL stays refused.
