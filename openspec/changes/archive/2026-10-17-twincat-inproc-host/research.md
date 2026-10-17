# Research 2026-10-16 — TwinCAT graphical write: facts, history, live measurements

## Paths today (file:line at 2fba343aa3)

**Dispatch.** `CreatesBody`, at `Driver/BeckhoffDriver.Content.cs:208-209`, is true when the body is blank or
`TcArchive.HasNoItems` (D23). It is used by `ResolveBody` (:535-555) and by the pre-flight `ValidateSource` (:161-173).

**Create.**
1. `TcObjectModel.ResolveGraphicalBody` (`TcObjectModel.cs:655-697`) runs `PlcOpenImport(file, 0)` into a scratch POU,
   copies its `ImplementationText`, then deletes the scratch POU.
2. `Stamp` (`Content.cs:615-649`) runs `MergeImporterSplits`, `TcNetworkWriter.Apply(byPosition)` and
   `DropImporterBoxOutputs`.

**Edit.**
1. `TcNetworkWriter.Apply` (:148-271) pairs networks by text and tries an in-place value write first.
2. On a shape change it runs `RefuseImport`, then checks `Rungs == 1` (:274-288).
3. `RebuildNetwork` (Order renumbered to 0, `Content.cs:568`), then `Spliceable`.
4. The result is spliced in with `MintFreshIds` (:297-318).

**Where the result lands.** The body is set through `ImplementationText` (`TcObjectModel.cs:575-583`). Member bodies
go through `TcItemArchive.SetMemberBodies`: export, rewrite, delete, import (:100-140, D32).

**Read.** The archive text goes through `TcArchive.Root` into `TcNetworkReader.ReadShown` (`Content.cs:446-448`).

**CODESYS, for contrast.** `CodesysObjectModel.ModifyObject` (:256-271) is GetObjectToModify → SetObject.
`CodesysNetworkWriter.Write` (:36-102) uses vendor mutators only, through `NwlInterop`.

**What ld-fbd-coverage keeps.** PLCopen create and archive editing (design.md:239, 256, 285-286, 417-418;
tasks.md:26-27).

**Engine vendor branches.** Only `ICodeStore.ValidateSource` (ICodeStore.cs:88, PushService.cs:127).

## History

| When | Established | Today |
|---|---|---|
| archive/2026-07-06-twincat-bridge-parity tasks.md:23-45 | The only full path is an in-process TcXaeShell extension; deferred. | Never started. |
| N6 | The shell is 32-bit .NET Framework; NWL reachability UNMEASURED. | Still unmeasured. |
| archive/2026-09-03-splice-graphical-body §11 | "Port to TwinCAT as they stand." | False at the constructor level. |
| N10 (e3b3d1801b) | The scripting engine is absent. | Over-generalised; corrected by N12. |
| N12 (b928375407) | The framework bootstraps; the wall is the .TcPOU dialect; in-proc only; not built. | The dialect wall does not apply in-proc. |
| archive/2026-09-24-graphical-vendor-parity-map | "N12 not-built is stale"; the output pin and the Execute box need in-proc, so its own change. | That change was never opened. |

- **No in-proc host was ever loaded,** and the N10/N12 probes were never committed.
- **Older probes can be recovered:** `git show 91c1f951a4^:packages/volt-cli/scripts/probe-nwl-*.py` and
  `git show 5312b799fe:packages/volt-cli/scripts/probe-tc-view-switch.ps1`.

## Refusals the PLCopen route causes

**Create only (`TcPlcOpenWriter`):**
- an Execute box (:249);
- an output pin wired to a variable (:275-282, C20);
- an N-destination jump (:431);
- a single-consumer branch point (:488-491, D30).

**Before the import (`TcUnmeasured.cs:79-104`):**
- an assign below the top level (S2);
- PARALLEL;
- a leaf-fed split (N22);
- `=> v` (C20);
- `SUPER^` (S5);
- a negated input (S6);
- also an edge-order negation (:35-44) and an ENO mismatch (:112-119).

**Edit (`TcNetworkWriter`):**
- a multi-rung network (:283-285, D25);
- an item-count change (:425-431);
- a dropped output pin (:862);
- flags on a jump or a SET/RESET coil (:1067, :1104);
- an unconnected pin without an id (:1254);
- a wrong network count (:183-187);
- `Spliceable` getting more than one network (Content.cs:585-590);
- ST⇄LD/FBD (:483-494, N24).

**Pinned by e2e:**
- refused-shapes:123,149
- real-project-shapes:94,101,116,205-224
- fanout:75,125,160
- language-change
- view-change:65
- roundtrip:254,298,321-335

## Live measurements (instance tc-inproc, XAE 9168, fixture 13)

**Today's route:**
- A single-consumer branch is REFUSED (D30).
- PARALLEL is REFUSED (NETWORK_UNSUPPORTED).
- A fan-out is ACCEPTED BUT RESHAPED: the branch point is gone, and `{OutputParam.Names := ['']}`
  `{OutputParam.Types := ['']}` leftovers appear.
- `( * m * 6)` is created; the build shows the IDE's own `'???' not defined`.

**(a) Loading code into the shell:**
- Per-user VSIX: "not a valid VSIX", or `0x80070490` (`GetInstanceForPath`).
- A per-user Extensions drop: never merged (no `UserExtensionsRootFolder`).
- A per-machine VSPackage: supported, but the `Extensions` ACL gives Users RX only, so it needs admin.
- An HKCU `…_Config` package plus autoload: refused by the session permission policy; not run.
- Legacy add-ins: no host since VS 2015.
- MEF: the same folders.
- The 3S plug-in folder: not a product route.

**(b)(c): unmeasured,** because nothing could load. A fixed-command probe package (env/list/dump/read/write/open) was
built and deleted; rebuilding it is about 250 lines.

**(d): `NWLObject.plugin.dll` 3.5.13.30, read via MetadataLoadContext:**
- **Every mutator is present:**
  - networks: AppendNetwork, InsertNetwork, RemoveNetwork;
  - trees: AppendTree, RemoveNetworkItem, GetTree, GetSplitPoint;
  - inputs: AppendInputItem, SetInputTree, SetInputFlag;
  - outputs: AppendOutputItem, InsertOutputItem, RemoveOutputItem, AppendParam;
  - BoxTreeParallel.Append and Insert.
- **Only `()` constructors.**
- **Construct then set works:** `IOperand.OperandExpr`/Type/Comment/SymbolComment/Address are settable, and
  `BoxTreeOperand.Operand/Flags` are get-only, so construct, then set (about 30 lines).

**B (hand-built archive):**
- **Census:** 254 .TcPOU files, 155 archives. Each type has one ordered member list; `BoxTreeParallel` occurs 0 times.
- **Attempt 1:** `cet="BoxTreeAssign"` on a mixed list. Accepted, saved verbatim, and unloadable after a reload (C2i).
- **Attempt 2:** the mixed list drops `cet`, and each element gets its own `t=`, per `ladder-demux.TcPOU`. It loads.
  - LD `VipWire2` and FBD `VipFbd`: pull returns the text across two reloads, the build has 0 errors, and the editor
    opens (not visually inspected).
- **Today's writer on that body:**
  - an operand edit is written in place;
  - AND→OR is refused (the D30 message);
  - a second consumer is refused (1→3 items).

Evidence: `evidence/` (the IDE-written archive, attempt 1 unloadable, attempt 2 loads, the member census).
