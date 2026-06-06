# Volt CODESYS Bridge

IronPython 2.7 bridge that runs **inside** CODESYS V3.5 SP19+ via the
built-in Scripting Engine. Exposes the same 5-endpoint wire contract
as the Beckhoff bridge (`/health`, `/refs`, `/fetch`, `/push`,
`/build`) so the Volt agent and the LSP conformance recorder work
against either IDE unchanged.

Distinct port from the Beckhoff bridge (**8556** vs Beckhoff's 8555)
so both can run side-by-side for differential testing.

## Run

CODESYS's `Tools → Scripting → Execute Script File` takes ONE file, so
the build produces a single-file bundle alongside the source tree:

- **`packages/volt-bridges/dist/volt-codesys-bridge.py`** ← the file
  you point CODESYS at. Self-contained (~120 KB, all 17 source modules
  base64-embedded + a tiny `sys.modules` bootstrap).
- `packages/volt-bridges/dist/CodesysBridge.zip` — same code as
  exploded source, for users who want to inspect / patch.

Build both with: `bash packages/volt-bridges/build-bridges.sh`

Then:

1. Open your project in CODESYS V3.5 SP19+
2. **Tools → Scripting → Execute Script File** → select
   `volt-codesys-bridge.py`
3. Connect from the Volt agent:
   ```bash
   VOLT_BRIDGE_PORT=8556 node packages/volt-agent/dist/cli/bin.js init
   ```
4. Close CODESYS to stop the bridge.

For development (no bundle round-trip needed): run
`python CodesysBridge/bridge.py` directly — the same `sys.path`
manipulation makes it work from the source tree too. Useful for
iterating on handlers without re-bundling.

## Test the helpers offline

The pure helpers (`st_splitter`, `code_helper`, `block_type_mapper`,
`st_assembler`) are written to also run under CPython 3 so they can be
unit-tested without launching CODESYS. The Python ports MUST produce
identical output to the C# originals — `test_st_splitter.py` ports the
C# splitter tests as cross-language ground truth.

```bash
cd packages/volt-bridges/codesys/CodesysBridge.Tests
python test_st_splitter.py
```

## Structure (mirrors `beckhoff/`)

| File | Mirrors |
|---|---|
| `CodesysBridge/bridge.py` | `BeckhoffBridge/Program.cs` + `HttpBridge.cs` |
| `CodesysBridge/codesys_connection.py` | `BeckhoffBridge/BeckhoffConnection.cs` |
| `CodesysBridge/ui_thread.py` | (new — CODESYS COM is STA and IronPython needs explicit `Form.Invoke` marshaling) |
| `CodesysBridge/handlers/health.py` | `BeckhoffBridge/HttpBridge.HandleHealth` |
| `CodesysBridge/handlers/refs.py` | `BeckhoffBridge/HttpBridge` refs path |
| `CodesysBridge/handlers/fetch.py` | `BeckhoffBridge/Handlers/FetchHandler.cs` |
| `CodesysBridge/handlers/push.py` | `BeckhoffBridge/Handlers/PushHandler.cs` |
| `CodesysBridge/handlers/build.py` | `BeckhoffBridge/Handlers/BuildHandler.cs` |
| `CodesysBridge/helpers/st_splitter.py` | `BeckhoffBridge/Helpers/StSplitter.cs` |
| `CodesysBridge/helpers/st_assembler.py` | `BeckhoffBridge/Helpers/StAssembler.cs` |
| `CodesysBridge/helpers/code_helper.py` | `BeckhoffBridge/Helpers/CodeHelper.cs` |
| `CodesysBridge/helpers/block_type_mapper.py` | `BeckhoffBridge/Helpers/BlockTypeMapper.cs` |
| `CodesysBridge/helpers/json_lite.py` | (new — IronPython JSON wrapper) |
| `CodesysBridge/helpers/log.py` | mirrors C# `Log` class |
| `CodesysBridge/helpers/compat.py` | (new — Py2/Py3 shims) |
| `CodesysBridge.Tests/test_st_splitter.py` | `BeckhoffBridge.Tests/StSplitterTests.cs` |

When a wire-shape change or splitter bug fix lands, the matching file in
the other bridge is obvious by name. Both implementations stay in sync.

The structural contracts that BOTH bridges hold (single walker, post-push
fetch invariant, itemCache through apply) live in
[`../INVARIANTS.md`](../INVARIANTS.md). Read that before adding a new
handler or porting changes between bridges.

## Threading model

CODESYS COM is STA — every Scripting API call **must** run on the IDE's
UI thread. The HTTP server runs on a background daemon thread; every
handler wraps its CODESYS-touching call through
`ui_thread.invoke_on_ui(fn)` which:

- Re-scans `Application.OpenForms` on every dispatch (cached form goes
  stale when dialogs close)
- Picks the largest visible form by area (CODESYS main window dwarfs
  dialogs)
- `BeginInvoke + WaitOne(30s)` — protects against modal-dialog deadlock
- **Refuses direct-call fallback.** No usable form → `UiThreadUnavailable`
  → handler returns `503 PLC_UI_UNAVAILABLE`. Refusing the request is
  strictly better than crashing the IDE.

This is the load-bearing architectural decision — getting it wrong
crashes CODESYS with no error message. Pattern lifted from prior bridge
implementations.

## End-to-end conformance against CODESYS

Once running:

```bash
# In another terminal:
cd packages/volt-agent
VOLT_BRIDGE_PORT=8556 bun run record:language
```

That writes a CODESYS-recorded `expected-tc.json` (overwrite the
TwinCAT one or save side-by-side for diffing). Any divergence between
the two recordings surfaces real IEC-61131-3 spec ambiguity.

## CODESYS Scripting API quirks (relevant when debugging)

- `system.get_message_objects()` — works without args on SP18, requires
  per-category enumeration via `system.get_message_categories()` on
  SP21+. `handlers/build.py` feature-detects.
- `obj.rename(new)` — on some SPs this **copies** instead of renaming;
  verify by name after, clean up the duplicate if needed.
- `create_pou` signature varies across SPs — use `_try_create` for
  multi-signature fallback.
- `obj.textual_declaration.text` can return `str` (bytes) or `unicode`
  depending on SP; `fetch.py:_safe_text` handles three encodings.

## Authoritative classification via PLCopenXML

POU kind (FB / FUNCTION / PROGRAM / INTERFACE), implementation
language (ST / IL / LD / FBD / SFC / CFC), and DUT subtype
(struct / enum / union / alias) all come from `obj.export_xml()`,
which returns full PLCopenXML 2.01. Equivalent of TwinCAT's numeric
`ItemType` enum — no header-text parsing required.

- `<pou pouType="functionBlock">` → kind
- `<body><FBD>` / `<ST>` / `<LD>` / etc → language
- `<dataType><baseType><struct/>` → DUT subtype
- For graphical POUs, the textual declaration is still text but the
  body is structural — fetched as `implementationXml` field

Header-keyword parsing (`classify_textual_pou`) is the FALLBACK that
only fires when PLCopenXML export fails. It also serves as the
top-level filter: we header-parse first to skip methods / actions /
properties that would otherwise show up as their parent POU's kind
(because `export_xml()` on a method returns the parent's full XML).

CODESYS exposes 3 distinct "textual" markers via `str(obj)`:
- `ScriptTextualDeclarationImplementationObject` — POUs with both
  declaration AND implementation (FBs, FUNCTIONs, PROGRAMs,
  methods, property GET/SET bodies)
- `ScriptTextualDeclarationObject` — declaration-only (TYPEs, GVLs,
  INTERFACEs, property signatures, interface method signatures)
- `ScriptTextualImplementationObject` — implementation-only
  (ACTIONs, TRANSITIONs)

`block_type_mapper.is_textual_item` matches all three.

## Cross-bundle re-execution (no CODESYS restart)

To iterate on the bridge — rebuild bundle, re-execute the script
without restarting CODESYS — the new bundle's `_stop_existing_bridge_if_any`
finds the previous bundle's `HTTPServer` via
`helpers.cross_bundle_state` (backed by `System.AppDomain.CurrentDomain.GetData/SetData`)
and shuts it down directly.

Why AppDomain and not `sys`:

- Module globals reset every script execution (fresh ScriptScope per
  `Execute Script File`). So `_server_singleton = None` on every run.
- CODESYS does NOT share `sys` attributes across script executions
  either, despite IronPython docs implying it does. **Verified
  empirically** — `setattr(sys, "_test", "x")` in one run is not
  visible in the next.
- `System.AppDomain.CurrentDomain` IS process-wide and survives every
  Execute Script File invocation for the CODESYS lifetime.

Other Windows / IronPython 2.7 gotchas baked into the bridge:

| Issue | Workaround | Where |
|---|---|---|
| `HTTPServer` is single-threaded — handler blocked on UI thread paralyzes serve_forever, so `/admin/shutdown` POSTs time out | `ThreadingMixIn` subclass | `_ReusableHTTPServer` in `bridge.py` |
| `BaseHTTPServer.server_close()` doesn't actually free the listening socket — netstat shows two LISTENING sockets after | Manually `getattr(server, "socket").close()` after | `_shutdown_server` in `bridge.py` |
| `SO_REUSEADDR` on Windows lets MULTIPLE sockets bind to same port | Always combine with explicit raw-socket close on the OLD socket | `_shutdown_server` |
| Worker thread `sys.stdout.write` silently fails in CODESYS (UI marshalling) — daemon-thread logs are LOST | Dual-output logger: stdout + `%TEMP%/volt-codesys-bridge.log` file. File log shows thread name. | `helpers/log.py` |
| IronPython 2.7's `ElementTree.tostring(elem, encoding="unicode")` raises `unknown encoding: unicode` (Py3-only kwarg) | Call without `encoding`, get bytes, decode | `plcopen_xml.extract_graphical_body` |
| PEP 515 numeric literals (`30_000`) are a syntax error in IronPython 2.7 | Plain integers | (codebase-wide) |
| CODESYS's bundled-script tracer renames pseudo-paths with `<>` to broken paths → console spam | Use `bundled_X.py` pseudo-paths, not `<bundled:X>` | `bundle.py` |

## Graphical-POU round-trip (FBD / LD / SFC / CFC)

Pull and push both work for graphical POUs via the **export-as-template
pattern** — the load-bearing architectural decision learned the hard way
when hand-crafted PLCopenXML kept failing CODESYS / TwinCAT's schema
validation (missing `fileHeader` / `contentHeader` / `coordinateInfo` /
…). Same pattern on both bridges; both unit-tested against captured
fixtures.

### Pull (`/fetch`)
1. Bridge classifies the POU's language via `plcopen_xml.classify`
2. For graphical POUs: bridge calls `obj.export_xml()`, parses the
   document, extracts just the `<body>` element via
   `plcopen_xml.extract_graphical_body`
3. Wire payload carries `sourceText` (textual decl) + `language` +
   `implementationXml` (raw `<body>` XML)
4. Agent's `embedGraphicalBody` splices the body XML between
   `END_VAR` and `END_PROGRAM` in the `.fbd` / `.ld` / `.sfc` / `.cfc`
   file — declaration stays grep-friendly ST

### Push (`/push`)
1. Agent's `extractGraphicalBody` splits the `.fbd` file at `<body>` —
   sends decl as `sourceText`, body XML as `implementationXml`
2. Bridge writes the decl via `textual_declaration.text = decl`
3. Bridge calls `existing.export_xml()` to get a **schema-valid
   template** (the same document CODESYS would emit for this POU,
   including all CODESYS-specific `addData` / vendor extensions)
4. `plcopen_xml.replace_body_in_pou` parses the template, surgical-
   replaces the `<body>` element with the incoming XML
5. Bridge calls `existing.import_xml(modified_document)` — CODESYS
   sees the same-named POU and updates in-place

**Why export-as-template?** Hand-crafting PLCopenXML was tried and
abandoned. Both vendors validate the schema strictly: CODESYS rejects
documents missing `<addData>`, TC rejects documents missing
`<fileHeader>` then `<contentHeader>` then `<coordinateInfo>`, and so
on. Using the vendor's own export as the template means we always get a
schema-valid envelope to splice into, regardless of vendor-specific
quirks.

**Create-new graphical POU from XML** isn't supported yet — the bridge's
`create_pou` path doesn't know how to set body language. Push rejects
those ops with a clear `GRAPHICAL_CREATE_UNSUPPORTED` error; user
creates the POU in the IDE first, then re-pulls and edits.

## Debug endpoints

Read-only inspection surface, not part of the agent wire contract:

- `GET /debug/build-id` — which bundle is serving (timestamp + content hash)
- `GET /debug/cross-bundle-state` — AppDomain registration dump
- `GET /debug/project` — `projects.primary` introspection
- `GET /debug/flat` — flat list of every descendant of project root
- `GET /debug/tree` — hierarchical tree (depth-limited)
- `GET /debug/item?name=X` — full introspection of one item
- `GET /debug/probe?name=X` — exhaustive attribute probe (CLR type,
  properties, methods, candidate attribute name probe — used to
  decide whether classification can be done structurally vs text-parsed)
- `POST /admin/shutdown` — manual escape hatch; cooperative shutdown
  via curl without restarting CODESYS
