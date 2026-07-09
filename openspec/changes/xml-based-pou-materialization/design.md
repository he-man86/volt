# Design: Unified XML Pipeline

## Status
- **Read path**: done (238 unit, 62/67 e2e pass, 854-item CODESYS: 44s→9.2s)
- **Write path**: not started
- **Clean architecture**: PouData/PouToStText created in Core; StAssembler/StSplitter still present as compatibility layer

## Target Architecture

One XML read (export_xml with children), one XML write (import_xml). No per-child COM calls. No dict-based intermediates.

```
IDE → ExportXmlWithChildren (1 COM) → PLCopen XML
     → PlcOpenPouParser.Parse (CPU) → PouData
     → PouToStText.Convert (CPU) → canonical ST → SHA1 hash

ST text → StTextToPou.Parse (CPU) → PouData
     → PouToXml.Convert (CPU) → PLCopen XML
     → WritePouXml (1 COM) → IDE
```

## Project Folder Structure

Everything shared between vendors lives in `Volt.Bridge.Core`. Vendor projects are thin wrappers.

```
packages/volt-bridge/src/
├── Volt.Bridge.Core/
│   ├── Graphical/                            # PLCopen XML layer
│   │   ├── PlcOpenDocument.cs                # XML helpers
│   │   ├── PlcOpenReader.cs                  # FBD/LD body reader
│   │   ├── PlcOpenPouParser.cs               # XML → ParsedPou
│   │   ├── PouToXml.cs                       # PouData → XML (NEW)
│   │   ├── GraphicalCode.cs                  # VG read/write
│   │   └── Vg/
│   │       ├── VgWriter.cs
│   │       └── VgBody.cs
│   │
│   ├── Workspace/                            # ST text layer
│   │   ├── PouData.cs                        # Canonical data model
│   │   ├── PouToStText.cs                    # PouData → ST text (NEW)
│   │   ├── StTextToPou.cs                    # ST text → PouData (NEW, adapter over StSplitter)
│   │   ├── SourceText/
│   │   │   ├── StAssembler.cs                # Legacy, remove after StTextToPou
│   │   │   └── StSplitter.cs                 # Legacy, remove after PouToXml
│   │   ├── Materializer.cs                   # Read orchestrator (refactored)
│   │   ├── ItemKind.cs
│   │   ├── Hasher.cs
│   │   ├── Versioning.cs
│   │   └── FolderPath.cs
│   │
│   ├── Sync/
│   │   ├── RefsService.cs
│   │   ├── FetchService.cs
│   │   └── PushService.cs                    # To simplify: PouToXml + 1× import
│   │
│   ├── Ide/
│   │   ├── IIdeDriver.cs
│   │   ├── ICodeStore.cs                     # Slim: ReadPouXml, WritePouXml
│   │   ├── IProjectTree.cs
│   │   ├── IIdeSession.cs
│   │   └── DriverBase.cs
│   │
│   └── Wire/
│       └── BridgeHttpServer.cs
│
├── Volt.Bridge.Codesys/                      # CODESYS-specific ONLY
│   ├── Ide/
│   │   └── CodesysObjectModel.cs             # COM: ExportXmlWithChildren, ImportXmlString
│   ├── Driver/
│   │   ├── CodesysDriver.cs
│   │   ├── CodesysDriver.Tree.cs
│   │   └── CodesysDriver.Code.cs             # Thin: ReadPouXml → ExportXmlWithChildren
│   └── Host.cs                               # Entry point (IronPython → Start())
│
└── Volt.Bridge.Beckhoff/                     # TwinCAT-specific ONLY
    ├── Ide/
    │   └── TcObjectModel.cs                  # COM: ProduceXml, PlcOpenImport
    ├── Driver/
    │   ├── BeckhoffDriver.cs
    │   ├── BeckhoffDriver.Tree.cs
    │   └── BeckhoffDriver.Code.cs            # Thin: ReadPouXml → ProduceXml with children
    └── Program.cs                            # Entry point (standalone .exe)
```

## Canonical Data Model

```csharp
// Core/Workspace/PouData.cs
public sealed record PouData(
    string Kind,           // "program", "function_block", "function", "interface"
    string Declaration,    // raw declaration text
    string? BodyLanguage,  // "ST", "FBD", "LD", "CFC", "SFC", null
    string? BodyText,      // raw body text or VG body
    List<ChildData> Children
);

public sealed record ChildData(
    string Kind,           // "method", "action", "property"
    string Name,
    string Declaration,
    string? BodyLanguage,
    string? BodyText,
    string? Folder,        // %FOLDER path, null for direct children
    string? GetterCode, string? SetterCode,
    string? GetterDeclaration, string? SetterDeclaration
);
```

## Slimmed `ICodeStore` Interface

```csharp
public interface ICodeStore
{
    // POU level – 1 COM call each direction
    string ReadPouXml(ItemRef item);              // export_xml with children
    void WritePouXml(ItemRef item, string xml);   // import_xml

    // Non-POU items (DUTs, GVLs — unchanged, already 0ms)
    string ReadDeclaration(ItemRef item);
    string ReadManifest(ItemRef item, string kind);

    // Graphical round-trip (unchanged)
    void WriteXml(ItemRef item, string xml);
}
```

## Vendor Driver — Thin Wrappers

```csharp
// CodesysDriver.Code.cs
ReadPouXml  → _om.ExportXmlWithChildren(item.Native)
WritePouXml → _om.ImportXmlString(xml, parent)

// BeckhoffDriver.Code.cs
ReadPouXml  → ExportParentWithChildren(item)
WritePouXml → _om.PlcOpenImport(xml)
```

## What Goes Away

| Component | Replaced By |
|-----------|------------|
| StAssembler | PouToStText |
| StSplitter | StTextToPou |
| Materializer dict shape | PouData |
| Materializer.CollectPropertyChildren | XML addData parser |
| Materializer.BuildFolderMap | Tree after import |
| PushService per-child COM writes | PouToXml → 1× import |
| GraphicalCode.Read | PlcOpenPouParser |
| COM fallback code | 0-fallback policy |

## Implementation Phases

### Phase 1: Create PouToXml (Core)
- Build PLCopen XML from PouData: `<InterfaceAsPlainText>` + `<body>` + addData children (`<method>`/`<action>`)
- Add unit tests: round-trip PouData → XML → PouData
- Handle FBD/LD by reusing GraphicalCode.Write's SpliceFbdLdBody

### Phase 2: Wire Write Path (CODESYS)
- Add `WritePouXml` to CodesysDriver (thin wrapper)
- Modify PushService.ApplySetItem to use PouToXml + WritePouXml
- Remove per-child CreateChild/WriteSourceText/DeleteChild
- Run lifecycle e2e tests: create→fetch→edit→delete

### Phase 3: TwinCAT Read + Write
- Implement ExportXmlWithChildren in Beckhoff driver
- Implement WritePouXml (PlcOpenImport)
- Verify XML format matches, run e2e on TwinCAT

### Phase 4: Cleanup
- Delete StAssembler.cs, StSplitter.cs
- Remove Legacy dict helpers from Materializer
- Remove CollectPropertyChildren, BuildFolderMap
- Remove GraphicalCode.Read

## CODESYS Headless Workflow

**Script**: `volt-scripts/codesys-bridge.ps1`

```
start   → build DLL, launch headless CODESYS, return immediately
wait    → poll /health until bridge up (max 120s)
up      → start + wait
down    → POST /shutdown, kill CODESYS
restart → down + up
```

**Dotnet SDK**: `C:\Users\marce\.dotnet\dotnet.exe` (SDK 8.0.422)

**Build**:
```powershell
& "$env:USERPROFILE\.dotnet\dotnet.exe" build `
  "packages/volt-bridge/src/Volt.Bridge.Codesys/Volt.Bridge.Codesys.csproj" `
  -c Release --nologo -v q
```

**Unit tests**:
```powershell
& "$env:USERPROFILE\.dotnet\dotnet.exe" test `
  "packages/volt-bridge/test/Volt.Bridge.Tests/Volt.Bridge.Tests.csproj" `
  -c Release --nologo -v q
```

**E2E tests** (run from `packages/volt-bridge`):
```powershell
$env:VOLT_TC_PORT = "8556"
& "$env:USERPROFILE\.bun\bin\bun.exe" test --timeout 60000
```

**Test project**: `packages/volt-bridge/test/CodesysTestProject.project`
**Large project**: `C:\Users\marce\Documents\codesysproject\Pro2193-94-95-96_COdesys.project` (854 items)

## Current State

- Build: 0 errors, 0 warnings
- Unit tests: 238/238 pass
- E2E tests: 62/67 pass (5 interface-related, not blocking write POC)
- New: PouData.cs, PouToStText.cs in Core
- Refactored: Materializer.cs uses PouData internally
- Next: Phase 1 — create PouToXml.cs
