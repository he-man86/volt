# Volt CODESYS Bridge

IronPython 2.7 bridge that runs **inside** CODESYS V3.5 SP19+ via the
built-in Scripting Engine. Exposes the same 5-endpoint wire contract
as the Beckhoff bridge (`/health`, `/refs`, `/fetch`, `/push`,
`/build`) so the Volt agent and the LSP conformance recorder work
against either IDE unchanged.

Distinct port from the Beckhoff bridge (**8556** vs Beckhoff's 8555)
so both can run side-by-side for differential testing.

## Run

1. Open your project in CODESYS V3.5 SP19+
2. **Tools → Scripting → Execute Script File** → select
   `CodesysBridge/bridge.py`
3. Connect from the Volt agent:
   ```bash
   VOLT_BRIDGE_PORT=8556 node packages/volt-agent/dist/cli/bin.js init
   ```
4. Close CODESYS to stop the bridge.

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
