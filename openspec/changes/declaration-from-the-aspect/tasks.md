## 0. Evidence already in hand (do not re-derive)

All of it measured on the live IDEs, 2026-08-27. Full tables in `transport-census.md`.

- **The bug:** every TwinCAT POU fails to materialize; `refs` returns libraries/DUTs/GVLs/task and no POUs.
- **The cause:** `InterfaceAsPlainText` is a vendor `addData` block the TC6 XSD defines as discardable, and
  `Materializer.BuildPouFromXml` requires it. 8/8 June exports carry it (2 of them with no variables at all, so
  it is unconditional); 0/2 live exports do, one of which declares 45 variables. 21 of the 22 element-level
  differences between the two generations are explained by POU content; that one is not.
- **Not a call Volt gets wrong:** reproduced through the COM interface AND the IDE's own export.
  `PlcOpenExport(bstrFile, bstrSelection)` has no options argument; `PlcOpenExport2` adds only `bSubTree`.
- **The aspect is exact and cheap:** `DeclarationText` / the `Interface` aspect, 0.1–0.3 ms against a ~20 ms
  document export, both vendors, get and set.
- **ST is safe:** `<ST><xhtml>` measured byte-identical to native CDATA. The typed `<interface>` is lossy for
  source text (alignment, blank lines) and is NOT a substitute.
- **Native transports rejected:** TwinCAT `DocumentXml` and CODESYS `export_native` are different encodings, and
  CODESYS's is GUID-typed. Two converters replacing one shared implementation — refused.

### Baseline

Offline **691 / 142 / 80 / 3**; CODESYS e2e **132 pass / 20 skip / 0 fail**; `bun run check` green with 4
`[UNMEASURED:]` markers. **TwinCAT e2e cannot run at all** — that is the thing this change fixes, and the real
gate.

---

## 1. Make TwinCAT readable again — the smallest change that does it

- [ ] 1.1 **`Materializer.BuildPouFromXml` takes the declaration from `ide.ReadDeclaration(item)`**, not from
      `parsed.Declaration`. The throw stays, but moves: an item whose ASPECT has no declaration is still a hard
      failure, because that genuinely cannot happen — the aspect is the object model, not a serialisation.
      **Test: `MaterializerDeclarationTransportTests` gains a case whose document has NO plaintext block and whose
      fake aspect does** — RED today, and it is exactly the live TwinCAT shape.
- [ ] 1.2 **Live gate, and the only one that matters here:** TwinCAT e2e runs. Not "passes" — *runs*. Record the
      first real pass/fail counts as the TwinCAT baseline; they have never existed.
      Prerequisites, learned the hard way: rebuild the connector bundle first (`scripts/build-cli.ps1` — a stale
      `dist/Connector/VoltBridgeTwincat.exe` will silently test three-week-old code), open the fixtures with
      `twincat-instances.ps1 up`, and have the connector running.
- [ ] 1.3 **Do not touch the write path yet.** 1.1 is a one-line source change with a test; shipping it alone
      un-breaks a vendor. Everything below is refactoring that can wait for review.

## 2. The write half — one method, symmetric

- [ ] 2.1 **`ICodeStore` gains `WriteDeclaration(ItemRef, string)`**, beside the existing `ReadDeclaration`.
      TwinCAT: `set_DeclarationText`. CODESYS: `SetAspectText(iobj, "Interface", text)` — already written, already
      used by the object-model write path.
- [ ] 2.2 **`PushService` writes the declaration through it**, and `PouDocument`/`PouSplice` stop carrying one.
      A push becomes: declaration via the aspect, body + members via the document.
- [ ] 2.3 **Delete `Source/Declaration.cs`** — `Read`, `Write`, `Establish`, `IsUnestablished`,
      `OwnDeclContainers`. The whole "find a declaration inside an XML document" problem class goes with it.
      Also delete `PlcOpenDocument.OwnDescendants`' declaration role and `PouReader.ChildDeclContainers` if
      nothing else needs them.
- [ ] 2.4 **Retire what becomes unaskable**, with a line in `DIALECT.md` saying why rather than a silent deletion:
      - **A7** (CODESYS emits the declaration twice; writing only the first is a silent no-op) — there is one
        aspect, not N blocks.
      - **U21** (does an accessor with a declared VAR get two copies?) — unasked.
      - **U22** (does any vendor emit `<get>`/`<set>` containers?) — unasked.
      - The read/write containment-predicate split unified in `splice-graphical-body` §7.6 — no containment
        question survives.

## 3. Tests are deleted with their subject, not adapted

- [ ] 3.1 **`DeclarationRuleTests`, and the declaration half of `PouSpliceTests`, are about locating a declaration
      in a document.** When that stops happening they are not "failing" — their subject no longer exists. Delete
      them and replace with aspect round-trip tests: write a declaration with awkward formatting (irregular
      alignment, a blank line before `END_VAR`), read it back, assert byte equality.
      **A test that survives the deletion of its subject was testing the wrong thing.** Do not adapt one to keep a
      number up.
- [ ] 3.2 **Record the count honestly.** Offline totals will DROP. That is correct, and the close-out says so —
      this repo has a standing rule that a test count is not a score.
- [ ] 3.3 **One new guard:** no production code requires an `addData` block. `handleUnknown` is `preserve` /
      `discard` / `implementation` by specification, so a required vendor extension is a latent outage. The guard
      is a source scan; `objectid` and `projectstructure` are the two Volt genuinely depends on (D4h) and they get
      an allowlist entry each, **with the reason**, so the dependency is at least declared rather than assumed.

## 4. Fixtures and the vendor record

- [ ] 4.1 **Record `POU_PBD`** — the live export and the native `.TcPOU`. First capture with a disabled network;
      the evidence behind three findings.
- [ ] 4.2 **Record `FB_PackML_Unit`** — a POU with 45 declared variables and NO plaintext block. The regression,
      preserved. Without it, this change reads as a story.
- [ ] 4.3 **`DIALECT.md`:** a row for "TwinCAT's PLCopen export omits `interfaceasplaintext`", cited to those
      fixtures; a row for "PLCopen carries no per-network `Title`/`Label`/`OutCommented`, and OMITS a disabled
      network entirely"; and **update the gap-refusal row — its stated reason is now CONFIRMED**, not inferred.
- [ ] 4.4 **Close the `DISABLED` marker in `NetworkTextWriter`** with the measured answer: the flag exists only in
      the native store; PLCopen carries nothing. `splice-graphical-body` §2.4 is not achievable via this transport.
- [ ] 4.5 **Record the TLB/reflection recipe in `ARCHITECTURE.md` or `scripts/README.md`.** Two hidden arguments
      have now cost real time (`PlcOpenImport`'s `options`, and the `PlcOpenExport2` hypothesis here). `TlbImp.exe`
      + reflection settles these in minutes. See `transport-census.md` §4.

## 5. Explicitly NOT in this change

- **Adopting a native transport.** Measured and rejected (`transport-census.md` §3). `DocumentXml` keeps real
  advantages — one read, 10× faster, carries `OutCommented`/`Title`/`Label`, and proved to carry children in both
  directions — and is recorded as a TwinCAT-only option with numbers, for whenever the fidelity gap justifies two
  converters. It does not today.
- **Rendering declarations from the typed `<interface>`.** Lossy for source text, and needs the
  elementary-vs-derived type table this repo has deliberately refused to build.
- **Reporting the TwinCAT regression upstream.** Worth doing, and it needs the installed build number
  (Help → About) which is not in hand. The claim is specific and ready: *`PlcOpenExport` no longer emits the
  `interfaceasplaintext` addData block while `objectid`, `projectstructure`, `fbdcalltype` and
  `fbd/implementationattributes` still are; the same project emitted it in June.*
- **`splice-graphical-body` §2.1/§2.2/§2.4.** Still splice-dependent, still open, untouched by this.

## 6. Close-out

- [ ] 6.1 Offline suites green at the new (lower) total; **TwinCAT e2e green** — the first time it ever has been;
      CODESYS e2e still 132/20/0; `bun run check` green.
- [ ] 6.2 Record what shipped against what was proposed, **including every prediction that turned out wrong.**
      Two are already logged in this change and belong in the close-out: `PlcOpenExport2` was expected to carry an
      options flag and carries `bSubTree`; CODESYS was asserted to have no native transport and has one.
- [ ] 6.3 Carry every open `[UNMEASURED:]` forward as a marker in the code it bears on — the TwinCAT build that
      changed, pragmas/comments/initial-values fidelity, and the `ChildCount` discrepancy after a document write.
