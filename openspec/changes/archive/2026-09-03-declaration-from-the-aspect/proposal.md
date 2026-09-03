## Why

**Volt cannot read a single TwinCAT POU right now.** Every one fails:

```
'PLC_PRG': its PLCopen export carries no <InterfaceAsPlainText>
           — a POU document without a declaration is a broken export
```

`PLC_PRG`, `FB_PackML_Unit`, `FB_PackML_ModeManager`, `POU_PBD`, both fixture projects. `refs` answers with
libraries, DUTs, GVLs and a task — and **no POUs at all**, because declaration-only kinds go through the
declaration aspect while POUs go through the document, and the document path throws.

### The cause is a category error, not a missing feature

`InterfaceAsPlainText` is not part of PLCopen. It is a **vendor extension**, carried as
`<data name="http://www.3s-software.com/plcopenxml/interfaceasplaintext" handleUnknown="implementation">`.

The TC6 XSD is explicit about what that means:

> `addData` — *"Application specific data defined in external schemata."*
> `handleUnknown` (**required**) — *"Recommended processor handling for unknown data elements. Specifies if the
> processor should try to preserve the additional data element, **dismiss the element** … or use the processors
> default behaviour."* Enumeration: `preserve` / `discard` / `implementation`.

The standard defines a vocabulary for **discarding** vendor data. Volt made one such block mandatory
(`Materializer.BuildPouFromXml` → `parsed.Declaration ?? throw`), and one vendor's behaviour change took out an
entire IDE.

That throw replaced a working second transport, on a measurement recorded in the commit that added it:

> *instrumenting the arm to throw produced ZERO hits across 195 live e2e tests on both vendors*

**That measurement is falsified.** 100% of TwinCAT POUs hit it here.

### Measured, and controlled for content

8 of 8 recorded June TwinCAT exports carry the block — **including two POUs with no variables at all**, so it is
emitted unconditionally. Both live exports carry zero, and one of them declares 45 variables.

| | declares vars? | `InterfaceAsPlainText` |
|---|---|---|
| JUNE `PLC_PRG`, `PLC_PRG_jump_sr`, `fbd_en_eno`, `ld_ton_rung_two_networks` | yes | ✓ 2 each |
| JUNE `fbd_ton_embedded_output`, `ld_four_networks_shared_rails` | **no vars** | ✓ 2 each |
| JUNE `FB_TcMembers`, `FB_TcFolderedMember` | yes | ✓ 10, 12 |
| LIVE `POU_PBD` | no vars | **0** |
| LIVE `FB_PackML_Unit` | **yes, 45** | **0** |

An element-by-element diff of the two generations shows 22 differences; **21 are explained by POU content** (the
live POUs have no members, no LD, no jumps, no comment boxes) and one is not. Details in `transport-census.md` §1.

Same project, same `productVersion` string, same vendor-extension namespace. Reproduced through **both** the COM
automation interface and the IDE's own PLCopenXML export, so it is not something Volt fails to ask for:
`PlcOpenExport(bstrFile, bstrSelection)` takes no options argument, and `ITcPlcOpenImportExport2.PlcOpenExport2`
adds only `bSubTree` (read from the type library — §4).

**This looks like a TwinCAT-side regression** — `objectid`, `projectstructure`, `fbdcalltype` and
`fbd/implementationattributes` are all still emitted; only this one stopped.
`[UNMEASURED: which TwinCAT build changed, and whether a project or global export setting is involved. Close by
reading Help → About and diffing against the June build.]`

**But the fix must not wait on that**, and must not depend on it being fixed. A block the specification defines as
discardable cannot be a structural requirement.

### The typed interface is not a substitute

PLCopen carries the declaration twice: as the vendor's verbatim text, and as the standard's typed
`<inputVars>`/`<outputVars>`/`<localVars>`. The typed form is **structurally lossy** for source. Measured on
`FB_PackML_Unit` — the native store holds what the engineer wrote:

```
VAR_INPUT
    xEmergencyStop  : BOOL;
    xRemoteMode                 : BOOL;      <- their alignment, irregular
    xMachineRunning : BOOL;
                                             <- their blank line
END_VAR
```

45 typed `<variable><type>` elements can reproduce names and types. They cannot reproduce that. Rendering the
declaration from them would silently reformat every declaration in a project on first push — a diff against work
nobody did, on every file.

**ST bodies are safe**, and that is worth stating because it bounds the problem: `<ST><xhtml>` is a verbatim text
carrier, measured **byte-identical** to the native CDATA at 7,316 characters. The fidelity hole is the
declaration, and only the declaration.

> **A declaration is source text. It comes from the one place that always has it exactly: the IDE.**

## What Changes

**One method for all declarations, both vendors, both directions: the IDE's declaration aspect.**

- **TwinCAT** — `ITcPlcPou.DeclarationText`, get and set (type library, §4).
- **CODESYS** — the `Interface` aspect; `ReadAspectText` / `SetAspectText`, both already in the driver.

`ICodeStore.ReadDeclaration` already exists and is already used for DUT/GVL. This makes it the source for POUs
too, adds the write half, and removes declaration handling from the document path.

What that deletes, permanently:

- **DIALECT A7** — CODESYS emits the declaration TWICE once a POU declares a variable, and writing only the first
  is a silent no-op. Gone: there is one aspect, not N blocks in a document.
- **U21** — whether an accessor with a declared VAR gets two copies. Unasked.
- **U22** — whether any vendor emits `<get>`/`<set>` containers. Unasked.
- The read/write **containment-predicate** split unified in `splice-graphical-body` §7.6 — no containment question
  survives, because nothing is being located inside a document.
- `Declaration.cs`'s `Write`/`Read`/`Establish`/`OwnDeclContainers` — the whole "find the declaration in XML"
  problem class.

Cost: **~0.1–0.3 ms**, against a ~20 ms document export. On the graphical path that is ~1% of a read already
being made; for a textual POU it is *cheaper* than today.

### Explicitly NOT changing: the transport

PLCopen stays. Both vendors' native document formats were investigated and measured (`transport-census.md` §2–3)
and **both are rejected**:

- **TwinCAT `DocumentXml`** — genuinely attractive: one property read, 0.3–5 ms vs ~20 ms, carries children in
  BOTH directions (proved by experiment), and carries `OutCommented`/`Title`/`Label` which PLCopen drops. But its
  FBD body is `<NWL><XmlArchive>` — a 3S object-archive **tree**, a different data model from PLCopen's graph.
- **CODESYS `export_native`** — exists, works, and emits the *same archive family in a different tag vocabulary*
  (`Single`/`List2`/`Null` vs `o`/`v`/`l2`) with types identified by **GUID** rather than name.

The hypothesis worth testing was that the two natives share an encoding, so one converter could serve both. It
was tested and **failed**. Two native converters, one of them GUID-mapped, replacing one shared PLCopen
implementation, is the opposite of the deduplication `splice-graphical-body` and `engine-layout` just did.

`DocumentXml` is recorded as a measured TwinCAT-only option, not adopted.

## Impact

- `Volt.Engine/Ide/ICodeStore.cs` — `WriteDeclaration` joins the existing `ReadDeclaration`.
- Both drivers — the write half (`set_DeclarationText`; `SetAspectText`, already present).
- `Volt.Engine/Ops/Materializer.cs` — declaration from the aspect, not from `parsed.Declaration`.
- `Volt.Engine/Source/PouSplice.cs` + `Declaration.cs` — declaration handling leaves the document path.
- Tests: `DeclarationRuleTests`, `PouSpliceTests`, `MaterializerDeclarationTransportTests` are all *about* finding
  a declaration in a document. They do not get adapted — they get **deleted with the behaviour they pin**, and
  replaced by aspect round-trip tests. A test that survives the deletion of its subject was testing the wrong thing.
- **Live gate**: TwinCAT e2e currently cannot run at all. This change is what makes that measurable, so the real
  gate is the first green TwinCAT e2e run, not the offline suite.
