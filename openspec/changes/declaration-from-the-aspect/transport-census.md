# Transport census — what each vendor can actually hand over, measured

Every number here came from the live IDEs on 2026-08-27 (TwinCAT Project13/14 in TcXaeShell, headless CODESYS
3.5.21.40), not from documentation. The probes are throwaway; the measurements are not.

---

## 1. The regression, controlled for content

An element-by-element diff of the June recorded exports against two live ones shows 22 differences. **21 are
explained by what the POUs contain**, and listing them matters — a raw diff would have looked alarming and been
almost entirely noise.

| Vanished | Explained by |
|---|---|
| `Method`, `Property`, `GetAccessor`, `SetAccessor`, `action`, `actions`, `Folder`, `returnType`, addData `method`/`property` | the live POUs have no members |
| `LD`, `coil`, `contact`, `leftPowerRail`, `rightPowerRail`, `ElementType`, addData `fbdelementtype` | no LD POU exported live |
| `jump`, `label`, `comment`, `content`, `outVariable` | no jumps, comment boxes or output vars in these two |
| `INT`, `UINT` | different variable types |
| **addData `interfaceasplaintext`** | **nothing — `FB_PackML_Unit` declares 45 variables and the block is absent** |

And the unconditionality check, which is what makes it a regression rather than a content artefact:

| Export | declares vars? | `InterfaceAsPlainText` |
|---|---|---|
| JUNE `PLC_PRG` | yes | 2 |
| JUNE `PLC_PRG_jump_sr` | yes | 2 |
| JUNE `fbd_en_eno` | yes | 2 |
| JUNE `ld_ton_rung_two_networks` | yes | 2 |
| JUNE `fbd_ton_embedded_output` | **no vars** | 2 |
| JUNE `ld_four_networks_shared_rails` | **no vars** | 2 |
| JUNE `FB_TcMembers` | yes | 10 |
| JUNE `FB_TcFolderedMember` | yes | 12 |
| LIVE `POU_PBD` | no vars | **0** |
| LIVE `FB_PackML_Unit` | **yes, 45** | **0** |

Two June exports carry the block with nothing to put in it — so it is emitted unconditionally, and its absence
live is not a function of the POU.

Complete structural census of the live `FB_PackML_Unit` export: `interface`, `inputVars`, `outputVars`,
`localVars`, 45 × `variable`, 45 × `type`, `body`, `ST`, `xhtml`, and exactly three addData blocks —
`ProjectInformation`, `ProjectStructure`, `ObjectId`. **Zero CDATA, zero `documentation`.** The declaration text
is genuinely not in the document, in any form.

---

## 2. Fidelity — what PLCopen carries exactly, and what it does not

| Construct | Verdict |
|---|---|
| **ST body** | **EXACT.** `<ST><xhtml>` is a verbatim carrier — measured byte-identical to the native CDATA, 7,316 chars, indentation and comments included. |
| **Declaration, as `InterfaceAsPlainText`** | EXACT — when emitted. Optional by specification (§Why). |
| **Declaration, as typed `<interface>`** | **LOSSY.** Names and types round-trip; the engineer's alignment, irregular columns and blank lines do not. |
| **Network `Title` / `Label` / `OutCommented`** | **NOT CARRIED AT ALL** — see §5. |
| `LineIds` (native line map) | Not carried; Volt models nothing equivalent. |
| Pragmas, per-variable comments, initial values | `[UNMEASURED]` — zero occurrences in either generation of fixture, so neither format has been tested. Close by exporting a POU with `{attribute ...}`, an inline comment and an initialiser. |

---

## 3. The native transports — investigated, measured, rejected

### TwinCAT `ITcPlcPou.DocumentXml` (get and set)

| | reads | time | decl | body | children | `OutCommented`/`Title`/`Label` |
|---|---|---|---|---|---|---|
| PLCopen export | 1 | ~20 ms | ✗ *this install* | ✓ | ✓ | ✗ |
| `DocumentXml` | 1 | **0.3–5 ms** | ✓ | ✓ | **✓** | **✓** |
| `DeclarationText` | 1 | 0.1–0.3 ms | ✓ | — | — | — |
| `ImplementationXml` | 1 | 0.6–2.6 ms | — | ✓ | ✗ | ✓ |
| `ProduceXml(true)` | 1 | 0.7–7.4 ms | — | — | — | ✗ — ~2 KB regardless of body size; tree metadata, not content |

**Children, both directions — proved.** Created `VltProbe_Members` (FB) + a METHOD; `DocumentXml` came back
carrying `<Method Name="DoThing">` with its own `<Declaration>` and `<Implementation>`. Then the write half:
spliced a `<Method>` and a `<Property>` (with a nested `<Get>` accessor) into a bare FB's own document and set it
back — both landed, with their declarations and ST bodies intact.

That is the requirement PLCopen was adopted for — *one format for the complete FB with all children* — met by the
native document, faster and with more fidelity.

Two observations from the write probe worth keeping:

- **The importer normalizes.** It reordered `<LineIds>`, re-indented the implementation, and **zeroed the POU's
  `Id`** to `{00000000-…}` while keeping the GUIDs supplied for the method, property and accessor. This is a
  partial answer to `splice-graphical-body` U6: TwinCAT's importer *does* rewrite what it is given, non-trivially.
- **`ChildCount` reported 1, not 2** immediately after the write, listing only the property. The tree view and the
  document view of "children" disagree right after a document write — and `RestoreChildFolders` and the orphan
  logic walk the *tree*. `[UNMEASURED: whether this is a refresh artefact or a real distinction.]`

### Why it is still rejected

The FBD body is a different **data model**, not a different syntax:

```
PLCopen (a GRAPH: flat elements, explicit edges)
  <FBD><inVariable localId="1"><expression>a</expression></inVariable>
       <block localId="3" typeName="AND">
         <inputVariables><variable formalParameter="IN1">
           <connectionPointIn><connection refLocalId="1"/>

Native NWL (a TREE: nested boxes, implicit connections)
  <NWL><XmlArchive><Data><o t="NWLImplementationObject">
    <v n="DefaultViewMode">"Fbd"</v>
    <l2 n="NetworkList" cet="Network">
      <o> <v n="Title">""</v> <v n="OutCommented">false</v>
        <l2 n="NetworkItems" cet="BoxTreeBox">
          <o> <v n="BoxType">"AND"</v>
```

Worth noting honestly: the tree shape may be *closer* to Volt's network text (itself an expression tree) than
PLCopen's graph is — `GraphReader` spends much of its length lowering that graph into a tree. So "different" does
not automatically mean "harder". It does mean a second, independent implementation.

### CODESYS `export_native` — the hypothesis that failed

The reason to look: TwinCAT's PLC engineering is 3S-derived (its PLCopen export uses
`http://www.3s-software.com/plcopenxml/…` namespaces; its native body is a 3S `XmlArchive`). **If** CODESYS's
native used the same encoding, one converter would serve both vendors and "one method for everything" would be
achievable with *fewer* moving parts than today.

Measured — `proj.export_native([obj], path)`, 3166 bytes:

```xml
<ExportFile><StructuredView Guid="{d9b2b2cc-…}">
  <Single xml:space="preserve" Type="{3daac5e4-…}" Method="IArchivable">
    <Null Name="Profile" />
    <List2 Name="EntryList">
      <Single Name="IsRoot" Type="bool">True</Single>
```

Same archive **family**, different tag vocabulary — `Single`/`List2`/`Null` + `Name=`/`Type=` against
`o`/`l2`/`n` + `n=`/`t=`. And decisively: **CODESYS identifies types by GUID**, not by name. A converter would
have to map opaque GUIDs to meanings and track them across CODESYS versions — strictly worse than the PLCopen it
would replace.

**Verdict: not one format, therefore not one converter.** PLCopen stays.

---

## 4. Reverse-engineering the vendor APIs — the tooling note

Twice now a hidden argument has cost real debugging time: `PlcOpenImport`'s `options` (DIALECT D4c, which made
"TwinCAT cannot replace in place" look like a vendor limit for months), and the `PlcOpenExport2` hypothesis in
this change. Both were settled in minutes once the API surface was read properly instead of guessed.

**TwinCAT — the type library is the complete, authoritative surface, and it is importable:**

```
TlbImp.exe "C:\TwinCAT\3.1\Components\Base\TCatSysManager.tlb" /out:TCatSysManagerLib.dll /silent
```
(`TlbImp.exe` ships with the Windows SDK, already on the dev machine.) Reflecting over the result gives every
interface, method, parameter name and type, offline. That is how these were established:

```
ITcPlcOpenImportExport    PlcOpenExport (bstrFile, bstrSelection)
ITcPlcOpenImportExport2   PlcOpenExport2(bstrFile, bstrSelection, bSubTree)   <- bSubTree, NOT options
ITcPlcPou                 DeclarationText {get;set}  ImplementationText {get;set}
                          ImplementationXml {get;set}  DocumentXml {get;set}  Language {get;set}
_ITcPlcImplementation     ImplementationText, but NO DeclarationText
```

That last line is a corroboration worth keeping: Beckhoff's own object model encodes the fact that **an ACTION has
no declaration**, which this repo previously learned the hard way.

**CODESYS — reflect over the plugin assemblies** (`ScriptDriver*.plugin.dll`), tolerating
`ReflectionTypeLoadException` and reading `ex.Types`. That is how `CreateNativeXmlExportService` /
`CreateNativeXmlImportService` were found alongside the PLCopen pair. For anything script-facing, the faster route
is a throwaway `--runscript` probe that prints `dir(obj)`.

---

## 5. Side findings — two markers closed, one confirmed

**`DISABLED` closes, negatively.** The `[UNMEASURED]` marker on `NetworkTextWriter` asked what XML carries a
disabled network. Answer: **PLCopen carries nothing at all.** A network disabled via "comment mode" is
`<v n="OutCommented">true</v>` in the native store, alongside `Title` and `Label`; the PLCopen export has none of
the three. So §2.4 of `splice-graphical-body` is not achievable through this transport at any granularity.

**A disabled network is OMITTED from the export entirely.** `POU_PBD` has 2 networks natively; its export has 1,
with every localId in band `1`. The disabled network is simply absent.

**Which CONFIRMS the gap-refusal inference.** `BodySpliceGuard` refuses a body whose network numbering has a gap,
saying it "means a disabled or hidden network would be lost" — recorded as an unverified inference, because no
fixture had a gapped body with a known-disabled network. There is one now, and the inference is **correct**.

That makes the gap refusal more load-bearing than `splice-graphical-body` §4 treated it: regenerating across a gap
really would delete a disabled network from a running program. The scoping done there is still right — a carried
network loses nothing — but the refusal itself must not be weakened further.

**Fixture to record:** `POU_PBD` — the first captured export with a disabled network, and the evidence behind all
three findings above.
