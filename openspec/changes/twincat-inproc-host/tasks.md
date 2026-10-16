Owner 2026-10-16: no in-proc host; the direction is a native-format writer (proposal "Decision"). Requires
`ld-fbd-coverage` archived. Measure first; swap only with the owner's OK.

## 1. Correct the docs

- [ ] 1.1 Fix the false parity claims: DIALECT N1 ("port unchanged": the constructors differ), `TcNetworkReader.cs:14-17`,
      `BeckhoffDriver.Content.cs:437-442`, ARCHITECTURE.md:123, volt-web `content.js:56`, D30, and the roundtrip
      multicoil comment.

## 2. Measure the native-format writer

- [ ] 2.1 Identity gate: a writer from the network model to `<NWL><XmlArchive>` that reproduces EVERY archive in the
      fixtures and corpora byte for byte. Any mismatch is a rule to learn, never a tolerance.
- [ ] 2.2 Templates: draw every node type in the TwinCAT editor (LD and FBD, a parallel, a single-consumer branch, an
      unconnected pin, an Execute box, a pin wired to a variable, a negated input) and capture them as fixtures. Never
      hand-write one.
- [ ] 2.3 Live: create, edit and rebuild each shape through `ImplementationXml` / `DocumentXml`. Then save, reload,
      build with 0 errors, open the editor, and pull the same text. Also measure the cost of one reload.
- [ ] 2.4 Report to the owner: which PLCopen refusals disappear, what stays, and the cost. The owner decides the swap.

## 3. Swap (only after the owner's OK)

- [ ] 3.1 Route TwinCAT create and rebuild through the native writer, and delete `TcPlcOpenWriter`, the
      splice/renumber/grouping code and the PLCopen-only refusals. Run e2e on both vendors.
