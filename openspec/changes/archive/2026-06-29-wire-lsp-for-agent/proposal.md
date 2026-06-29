## Why

The core premise — the volt LSP gives the AI live PLC diagnostics so it writes correct Structured
Text — is **not actually wired for a real PLC project**. In a session editing an end-user TwinCAT/CODESYS
workspace, the agent reported: *"there's no LSP hooked into this session — I just know IEC 61131-3
conventions from training data,"* and it produced malformed interface ST (parameterless `METHOD`s with
no `END_METHOD`) that `volt push` rejected.

Root cause: the LSP is registered only in the **Volt dev repo**'s `.opencode/opencode.json`, with a
**repo-relative** command path (`./packages/volt-lsp-codesys/dist/bin.js`) that resolves *only* when
opencode's project dir is the Volt repo. A consumer's PLC project has no such registration and no
resolvable path — so the agent edits PLC code **blind**. That — not the LSP-vs-bridge strictness gap
(secondary) — is why the generated logic was bad.

## What Changes (to investigate / design — this is a capture, not a built solution)

- **Deliver + register the LSP into a consumer project.** `volt init` (which already generates
  language-reference skills into `.claude/`) should also wire the volt LSP into the project's opencode
  config with a **resolvable** command (the published `@opencode-ai/volt-lsp-codesys`, via node_modules
  / a global install / a bundled binary), so the agent gets `.st`/`.itf`/… diagnostics while editing.
- **Confirm opencode surfaces LSP diagnostics to the agent** (after edits / via a diagnostics tool) —
  verify the agent actually *consumes* them, not merely that the server process runs.
- **(secondary) LSP↔bridge diagnostic parity** — once wired, the LSP must redline what the bridge
  rejects (e.g. the missing-`END_METHOD` interface form), so write-time feedback predicts push success.

## Capabilities

### Modified Capabilities
- `language-server`: the LSP must be wired into a **consumer** project's agent session (not only the dev repo), and its diagnostics must cover what the bridge rejects.

## Impact

Investigation + `volt init` wiring + a parity test. No fix committed yet — recorded so it isn't forgotten.
