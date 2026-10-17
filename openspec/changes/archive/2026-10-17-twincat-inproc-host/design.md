## Native-format writer: the plan (overnight run 2026-10-16, branch `twincat-native-writer`)

Decision C (proposal "Decision") stands: TwinCAT's graphical body is written as its own `<NWL><XmlArchive>` text, through
the supported `ImplementationText` door, and PLCopen goes. This section is the plan the run works to; the results are
recorded beside it as each step closes.

### Inventory: PLCopen in `packages/volt-cli` today

**Product code that WRITES through PLCopen (all TwinCAT):**
- `Volt.Ide.Twincat/Ide/TcPlcOpenWriter.cs` (503 lines): the model lowered to a PLCopen document, and the create-only
  refusals (Execute box, `=> v`, N-destination jump, single-consumer branch D30).
- `TcObjectModel.ResolveGraphicalBody` / `Adopted` (`TcObjectModel.cs`): `PlcOpenImport(file, 0)` into a scratch POU,
  copy its `ImplementationText`, delete the scratch. The ONLY `PlcOpenImport` call in `src/`. There is no
  `PlcOpenExport` call in `src/`.
- `BeckhoffDriver.Content.cs`: `ValidateSource` (lowers every created body through `TcPlcOpenWriter` as the pre-flight),
  `ResolveBody` (create = import + `Stamp`; edit = `TcNetworkWriter.Apply` with `RebuildNetwork`), `RebuildNetwork`,
  `Spliceable`, `Stamp`, `LostNetworks`, `CarriesDetail`, `HasFlags`.
- `TcNetworkWriter.cs` (the in-place editor): `MergeImporterSplits`, `DropImporterBoxOutputs`, `Imported`, `Splice`,
  `MintFreshIds`, `Rungs`, `RefuseUnbuildable` and the `resolve` callback — the importer's half.
- `TcUnmeasured.RefuseImport` (S2, PARALLEL, N22, C20, S5, S6): refusals raised because the import cannot take a shape.

**Not PLCopen, and staying:** `TcItemArchive` (D32 member bodies, member moves) exports and imports TwinCAT's NATIVE
per-item zip (`ExportChild`/`ImportChild`, a `.TcPOU` inside) — the same native format this change writes. It only
received PLCopen-built archives because a member's body was created through `ResolveGraphicalBody`.

**Scripts and fixtures:** `scripts/record-tc-import.ps1` (records what the import builds — becomes the corpus
generator's authoring half, see below), `test/fixtures/nwl-corpus/twincat-project14/import/*.plcopen.xml`,
`fixtures/tc-pou/POU_PBD.plcopen.xml`, `importer-*.TcPOU`.

**Tests built on the import:** `TcPlcOpenWriterTests`, `TcPlcOpenInvariantTests`, `TcImporterSplitTests`, part of
`TcNwlCompletenessOracleTests` (it runs the recorded imports through `Adopted`/`Spliceable`), `TcStructuralEditTests`,
`TcRebuildLossTests`; e2e `fanout`, `refused-shapes`, `real-project-shapes`, `parity-fixes`, `grouping`,
`create-shapes`, `uncovered-shapes`, `roundtrip`.

**Docs:** DIALECT D22/D25/D30/C20/N1/N10/N11/N12/N22/N39, `ARCHITECTURE.md`, `docs/driver.html`, `docs/network-text.html`,
`README.md`, `test/e2e/README.md`, engine comments that name PLCopen as history (`NetworkModel.cs`, `FbdOperators.cs`,
`PushService.cs`, `ICodeStore.cs`, `DriverBase.cs`) — history stays history; claims about today get corrected.

### Steps

0. This plan.
1. **Identity gate** (`TcArchiveWriter`, new file): the archive's object graph — the `XElement` tree `TcArchive` reads
   — back to text. A test reproduces every vendor-written archive in the repo byte for byte (and, opt-in through
   `VOLT_TC_ARCHIVE_DIRS`, every one on the machine). Every mismatch is a rule, recorded in the writer's header.
   Archives Volt or a human wrote (`*.derived.*`, the evidence attempts, `VOLT_*` POUs) are listed by name and must
   NOT reproduce — the gate proves it can tell.
2. **Corpus and templates.** A generator (`scripts/tc-native-corpus.ps1`) creates many networks in a live TwinCAT
   through TODAY's working route (PLCopen import + in-place edit), in LD and FBD, at several sizes, nestings, pin
   counts, fan-outs and network counts, plus edits, and captures every saved archive. That corpus feeds the identity
   gate and teaches the minting rules (Id / VarId / BranchCounter / ValidIds, member order, `cet` vs `t=`, TypeList).
   Node templates come only from archives TwinCAT wrote (the corpus included). A node type TwinCAT cannot be made to
   write stays refused, with the reason.
3. **Model → archive builder** (`TcArchiveBuilder`, new file): elements built from the templates' member lists, ids
   minted by the learned rules. Offline: model → archive → `TcNetworkReader` = model, for every shape.
4. **Live** (`tc-native`, fixture 14): every shape created, edited and rebuilt through the native writer; save,
   reload, build 0 errors, editor opens, pull returns the same text. e2e under `test/e2e/graphical/`.
5. **Swap**: create and rebuild go through the builder. `TcPlcOpenWriter`, `ResolveGraphicalBody`, `Stamp`/`Spliceable`,
   the importer cleanup in `TcNetworkWriter` and the PLCopen-only refusals are deleted; DIALECT/ARCHITECTURE corrected.
   No fallback to PLCopen: a shape the native writer cannot build is refused by name with the measured reason.
6. Gates: build, every dotnet suite, `bun test test/unit`, lint, check, and the live e2e on BOTH vendors.

**Stop rules.** If step 1 cannot reach byte identity on real archives, stop there. If a reload shows a POU TwinCAT
cannot load, that shape stays refused, and the IDE is closed without saving.

**Rebase discipline.** ld-fbd-coverage 2R is rewriting `TcNetworkWriter`, `TcNetworkReader`, `TcArchive`,
`TcUnmeasured`, `NetworkModel` and the network-text files in the main tree. The native writer lives in NEW files; the
edits to those shared files are minimal and in their own commits.

### Results (2026-10-17)

**1. Identity gate — byte identical.** `TcArchiveWriter` reproduces every archive TwinCAT wrote: 164 in the repository
(148 NWL; the native corpus included) and 216 with the machine's TwinCAT samples (`VOLT_TC_ARCHIVE_DIRS`: OneDrive
`TcXaeShell`, `PlcSample_BasicPlcElements`, VS2017 backups, PLCAssist fixtures; 187 NWL), 0 mismatches. Nine archives
are named as NOT vendor-written and must fail the gate (the two hand-built attempts, three `*.derived` fixtures, an old
`VOLT_*` builder output, and three Volt creates whose `DropImporterBoxOutputs` left a blank line and a `cet` on an empty
list, stored verbatim). Rules learned: see `TcArchiveWriter`'s header and DIALECT N42 (b). Measured on the way: TwinCAT
stores `ImplementationText` verbatim through save, close and reopen (a whitespace-shifted archive came back shifted).

**2. Corpus and templates.** `scripts/tc-native-corpus.ps1` + `TcNativeCorpusTests`: 130 networks (110 network-text
shapes lowered by the then-shipped PLCopen writer, 21 hand-written TC6 bodies for LD contacts/coils/edges/parallels and
FBD pin modifiers) imported into scratch POUs, 130 recorded, 0 refused (2 shapes the lowering refused are listed). Node
templates and where they came from:

| node | template source (TwinCAT-written) |
|---|---|
| Operand, BoxTreeOperand, BoxTreeAssign, BoxTreeBox (operators, functions, FB calls), Network, NWLImplementationObject | native corpus (importer) |
| BoxTreeDemux (definition + reference, fan-out) | native corpus `Vn_fanout_into_box`, `Vn_fanout_two_wires`; `ladder-demux.TcPOU` (drawn) |
| SET/RESET/negated coils, negated/rising/falling contacts, jump, return flags | native corpus `Vn_ld_*`, `Vn_fbd_*`, `Vn_jump_*`, `Vn_return_*` |
| BoxTreeTerminator | `drawn-refused-shapes.TcPOU` (drawn in XAE) |
| Execute box (STSnippet / STImplementationObject / TextDocument / TextLine) | `execute-box.TcPOU` (drawn in XAE) |
| output pin wired to a variable | `ladder.TcPOU`, `drawn-refused-shapes.TcPOU`, `fbd.TcPOU` (drawn) |
| EN/ENO box | native corpus `Vn_enable_*`; `fbd.TcPOU` (drawn) |
| BoxTreeParallel | **none**: TwinCAT's importer lowers parallel contacts to an OR box (`Vn_ld_parallel*`); refused |

**3. Builder.** `TcArchiveBuilder`: the `NetworkModel` (CODESYS's) as the archive graph, mirroring `CodesysNetworkWriter`
node by node (output names/types from `NetworkMembers.Buildable`, the slot layout, EN as input slot 0), ids in the
importer's order, `CallType` from a table learned from the corpus. Offline (`TcArchiveBuilderTests`): 152 vendor bodies
read and built back read as the same model; every element built has a member list TwinCAT wrote; the `CallType` table is
what TwinCAT stores; every corpus text and 22 shapes beyond the import, LD and FBD, pull back as pushed.

**4. Live (tc-native, TwinCAT Project14, TcXaeShell 15.0 / 3.1.4024)** — `test/e2e/graphical/native-writer.test.ts`:

| shape (LD and FBD each) | stores | reload | build | editor | edit + reload |
|---|---|---|---|---|---|
| single-consumer branch | ok | ok | ok | ok | ok |
| fan-out to two coils | ok | ok | ok | ok | ok |
| leaf-fed split | ok | ok | ok | ok | ok |
| unconnected pin | ok | ok | ok | ok | ok |
| pin to variable (`ET => el`) | ok | ok | ok | ok | ok |
| negated input (`NOT a AND b`) | ok | ok | ok | ok | ok |
| SET coil / RESET coil | ok | ok | ok | ok | ok |
| rising edge | ok | ok | ok | ok | ok |
| Execute box | ok | ok | ok | ok | ok |
| multi-rung network | ok | ok | ok | ok | ok |
| assign below the top level | ok | ok | ok | ok | ok |
| jump + label / unconditional return | ok | ok | ok | ok | ok |
| unconnected coil / empty network / header (label, title, disabled, comment) | ok | ok | ok | ok | ok |
| enabled MOVE read through `.ENO` | ok | ok | ok | ok | ok |
| function call by pin name | ok | ok | ok | ok | ok |
| SUPER^ call (census-shapes, an EXTENDS pair) | ok | — | ok | — | — |

"build" is one build of the project with an instance of every shape: 0 errors. A reload (save, close, reopen, connect)
costs 13.8-15.1 s. Refused by name, measured: PARALLEL (no template), an enabled AND/OR/XOR/NOT built with only its ENO
(`__ImpVar not defined`), a flag on a box input pin (the reader cannot read `InputFlags` back), a consumed call that wires
a pin by name (no slot left for its consumer), and — as on CODESYS — UNSUPPORTED lines and S4.

**5. Swap.** Done on the branch. Deleted: `TcPlcOpenWriter.cs` (503 lines), `Namespaces.cs`, `ResolveGraphicalBody` +
`Adopted` (`TcObjectModel`), `WithViewMode` (`TcArchive`), `Stamp`/`Spliceable`/`RebuildNetwork`/`LostNetworks`/
`CarriesDetail`/`HasFlags` (`BeckhoffDriver.Content`), `MergeImporterSplits`/`DropImporterBoxOutputs`/the positional
stamp/`Rungs` (`TcNetworkWriter`), `TcUnmeasured.RefuseImport`, `scripts/record-tc-import.ps1` and its recordings, and the
tests whose subject was the lowering or the importer. No PLCopen call remains in `src/`.

### Rebase notes (against ld-fbd-coverage 2R)

Both touch: `TcNetworkWriter.cs` (Apply's splice/insert, removal, TypeList sync, the importer helpers deleted),
`TcNetworkReader.cs` (one doc paragraph), `TcUnmeasured.cs` (RefuseImport deleted), `TcArchive.cs` (`WithViewMode`
deleted), `BeckhoffDriver.Content.cs` (ResolveBody/ValidateSource/Created, Stamp etc. deleted), `TcObjectModel.cs`, the
TwinCAT tests that used the importer (`TcStructuralEditTests`, `TcNwlCompletenessOracleTests`, `TcNetworkWriterTests`,
`TcPreflightTests`), and the graphical e2e files. Each shared file's change is its own commit. The builder reads only
the `NetworkModel` and `NetworkMembers.Buildable`/`NetworkText.HasEnoOutput`/`WithDeclaredType`: if 2R changes those,
`TcArchiveBuilder` follows them, and `TcArchiveBuilderTests` + `native-writer.test.ts` re-judge it.
