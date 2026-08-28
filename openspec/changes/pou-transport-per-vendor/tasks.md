## 0. Evidence — measured, do not re-derive

Full tables in `checklist.md`. Condensed, because this is the part that must survive:

- **TwinCAT PLCopen fails 7 requirements**: R1 declaration, R6 member declarations, R10 network metadata,
  W1/W6/W8 their write halves, W11 in-place replace, W14 no-normalization. Every crisis this month is one of
  those rows.
- **`DocumentXml` passed all four deciding experiments.**
  - **R3** — the body is an EXPRESSION TREE (`BoxTreeAssign` / `BoxTreeBox` / `BoxTreeOperand` / `Operator` /
    `ParamList`), measured on **both** LD and FBD. `contact` / `coil` / `PowerRail` are **0 in both** — a ladder
    is a VIEW (`DefaultViewMode`), the storage is already the lowered boolean form. Operands carry `Type` inline.
  - **W14** — set a document back unchanged: byte-identical except the POU `Id`, which PLCopen zeroes anyway.
    Measured on both languages (15,175→15,175 / 21,689→21,689 chars, one line each).
  - **W12** — malformed documents are refused WHOLE with a line/position diagnostic, POU byte-intact. Stronger
    than the PLCopen import.
  - **R9** — folders are structural: `<Folder Name="Inner"/>` plus `FolderPath="Inner\"` on the member.
- **CODESYS PLCopen carries the declaration and members fine.** Its native was rejected on ONE 3,166-byte sample
  (GUID-typed tag vocabulary) — see §1, which is why this is not yet settled to the same standard.

### What the TwinCAT converter DELETES rather than adds

The cost argument that rejected `DocumentXml` was backwards. On a native transport these become unnecessary:

| today, for TwinCAT | why it goes |
|---|---|
| `GraphReader.LowerLadder` | there are no contacts to lower |
| `InstanceTypes` declaration text-parse ("an approximation forever") | operands carry `Type` |
| `RestoreChildFolders` | `FolderPath=` is in the document |
| the whole carry + refusal machinery | nothing is regenerated |
| declaration-from-the-aspect, for TwinCAT | the document carries it verbatim |

### Traps that each cost real time — every one reads as "the API is broken"

1. A name walk finds the WRONG item when names repeat (`PLC_PRG` exists three times in one project) and returns
   0 chars.
2. `PlcOpenImport` settles ASYNCHRONOUSLY — the item stays invisible in the same COM session even after
   re-acquiring the PLC-project handle, while a fresh process sees it at once. Import and probe must be separate
   invocations. (D4d covers handles to the *replaced* item; this is the parent's enumeration and is wider.)
3. **PowerShell's COM binding can return the parameterized `Child` property as a COLLECTION**, so a helper that
   returns a COM object yields `System.Object[]` and every later `.ChildCount` comparison fails. Keep tree
   searches INLINE and cast (`[int]`, `[string]`).
4. `DocumentXml` is 0 chars on folders, libraries, task references and a POU's ACTION child (an action exposes
   `ImplementationXml`).
5. TwinCAT language codes: **ST=1, SFC=3, FBD=4, CFC=5, LD=6**.

---

## 1. FIRST — hold CODESYS to the same standard

`export_native` was rejected on one sample. That is thinner evidence than TwinCAT's four experiments, and
"best possible per vendor" means measuring both. **Run the identical four experiments** before any transport is
locked:

- [ ] 1.1 **R3** — read a CODESYS native document for an FBD and an LD POU. Is it an expression tree or a graph?
      Are contacts stored, or is a ladder a view there too?
- [ ] 1.2 **W14** — set a native document back unchanged. What is perturbed?
- [ ] 1.3 **W12** — set a malformed one. Refused whole, or partially applied?
- [ ] 1.4 **R9/R10** — does it carry in-POU folders, and `OutCommented`/`Title`/`Label`?
- [ ] 1.5 **The GUID question, properly.** Are the type GUIDs stable across CODESYS versions and documented, or
      opaque? This is the entire basis of the current rejection and it was never tested.
- [ ] 1.6 **Decide, and write the verdict into `checklist.md` with the same rigour.** If CODESYS's native also
      wins, `lossless-push` may not be needed AT ALL — which would be the largest simplification available.

**Nothing below starts until §1 is answered**, because it changes what the engine must still contain.

## 2. The boundary — this is the design error, and it blocks everything

`ICodeStore` currently demands a PLCopen document from every driver:

```csharp
string ReadXml(ItemRef item);
void   WriteXml(ItemRef item, string xml);
```

An IDE without a PLCopen export **cannot implement the contract**. That is why TwinCAT cannot adopt its own
better transport: the engine will not let it. The refactor is not cleanup after the transport change — it is what
unblocks it.

- [ ] 2.1 **`ICodeStore` speaks `ItemContent`**, not XML: `ReadContent(ItemRef) → ItemContent` /
      `WriteContent(ItemRef, ItemContent)`. `ItemContent` already exists and is already vendor-neutral
      (`Kind`, `Declaration`, `Body`, `Members`, folders) — the boundary is simply drawn one layer too low.
- [ ] 2.2 **The engine stops knowing what PLCopen is.** No `plcopen` string, no TC6 namespace, no `addData`
      anywhere under `Volt.Engine/`.
- [ ] 2.3 **`GraphModel` is the neutral graphical intermediate** and STAYS in the engine. Each driver converts
      its own body form to it. Network text — Volt's own format — stays in the engine too.
- [ ] 2.4 **`DIALECT.md` moves out of the engine.** A vendor-facts document inside the vendor-neutral package is
      the design error in miniature. Split it per vendor.

## 3. Target layout

```
Volt.Engine/                     VENDOR-NEUTRAL. Knows no file format any vendor defines.
  Ide/            ICodeStore (ItemContent in, ItemContent out), IProjectTree, TreeNav
  Item/           ItemKind, ItemRef, ItemContent
  Source/         VOLT's OWN formats only
    St/             the canonical .fb file layout (StReader/StWriter)
    Network/        network text + GraphModel  (the neutral graphical model)
  Sync/           Materializer, PushService, FetchService, Versioning
  Wire/           the pipe contract

Volt.Cli.Ide.Codesys/
  Format/PlcOpen/   PlcOpenDocument, PouReader, PouSplice, Declaration, Namespaces,
                    ProjectStructure, GraphReader, GraphWriter, DIALECT-codesys.md
  Ide/ Driver/      as today

Volt.Cli.Ide.Twincat/
  Format/Native/    TcDocument reader/writer, BoxTree <-> GraphModel, DIALECT-twincat.md
  Ide/ Driver/      as today
```

- [ ] 3.1 Move the PLCopen layer into the CODESYS package. It stops being shared and becomes what it always was:
      one vendor's serialization.
- [ ] 3.2 Keep `GraphModel` + network text in the engine — they are Volt's, not a vendor's.
- [ ] 3.3 `bun run check` must fail if the engine references a vendor format again. A guard, not a convention:
      this is the error we are correcting, and nothing currently prevents its return.

## 4. The TwinCAT native converter

- [ ] 4.1 `BoxTree*` → `GraphModel`. Shapes measured: `BoxTreeAssign` (plain assignment, LD),
      `BoxTreeBox` carrying its own `OutputItems`/`InputItems` (FBD), `BoxTreeDemux` (EN/ENO), `BoxTreeOperand`,
      `Operand`, `Operator`, `ParamList`. More than one shape — stated plainly — but every one is a LOCAL tree:
      no `refLocalId` edges, no id chasing, no ladder lowering.
- [ ] 4.2 `GraphModel` → `BoxTree*`, and the whole-document write.
- [ ] 4.3 **Take `Title`/`Label`/`OutCommented` into the model.** A disabled network is running-program state and
      this transport carries it; the model currently has nowhere to put it (`NetworkTextWriter` emits `DISABLED`
      but nothing reads it back across XML).
- [ ] 4.4 Close the coherence question first: a method's `<ST>` read back EMPTY from the document immediately
      after `ImplementationText` was set. Understand that before writing members through the document.

## 5. What happens to the other in-flight changes

- **`declaration-from-the-aspect`** — SHIPPED and stays. The aspect is the object model rather than a
  serialization, so it is correct under any transport. For TwinCAT it may become redundant (the native document
  carries the declaration verbatim); redundant is not wrong, and it stays until that is proven.
- **`lossless-push`** — becomes **CODESYS-only**, or disappears entirely if §1 finds a better CODESYS transport.
  It exists because a body is regenerated from a projection; TwinCAT will no longer regenerate.
- **`splice-graphical-body` §2.1** (the LD contact demotion) — **closes for TwinCAT for free**: there are no
  contacts in the native form. Stays open for CODESYS pending §1.

## 6. Gates

- [ ] 6.1 Both vendors' e2e green, from a verified-clean environment (solution loaded, `--xae-pid` workers,
      pid-suffixed pipes — the checklist in `declaration-from-the-aspect` §6 exists because three runs were
      misread as regressions).
- [ ] 6.2 **Byte-for-byte round-trip on a corpus of real POUs**, per vendor: pull, push unchanged, pull again,
      compare. On TwinCAT this should be exact; where it is not, the difference is the vendor's normalization and
      must be named.
- [ ] 6.3 The wire is unchanged: both vendors still serve byte-identical responses for the same project. This is
      the invariant the whole split rests on.

## 7. Explicitly NOT in this change

- **Changing the wire or the parity boundary.**
- **CFC/SFC/IL** — still unsupported, still markers.
- **A third IDE.** The refactor makes one possible; adding one is separate work.
