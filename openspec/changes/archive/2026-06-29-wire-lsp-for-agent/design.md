## Context

Triggered by a real failure: an AI-authored PackML library pushed via `volt push` was rejected by the
bridge (`I_EquipmentModule.st: Missing END_METHOD`). Investigation found two stacked problems.

```
  Agent edits PLC project (~/Documents/…)          Volt dev repo (.opencode/opencode.json)
  ──────────────────────────────────────           ──────────────────────────────────────
  LSP command path: ./packages/volt-lsp-…/bin.js   resolves ✓ (cwd = repo root)
        └─ no packages/ here → DOESN'T RESOLVE ✗    debug lsp diagnostics → runs, returns {}
  no .opencode registration in the project ✗
        ⇒ agent has NO LSP → writes ST from
          training data → malformed output
```

## The two layers (primary first)

1. **Wiring (primary).** The LSP only exists for the dev repo. A consumer's PLC project gets no LSP, so
   the agent has no PLC feedback loop at all. The agent itself confirmed it. This is the real defect.
   - The delivery seam already exists in spirit: `volt init` writes language-reference skills into the
     consumer's `.claude/`. It should *also* register the LSP in the consumer's opencode config, with a
     command that resolves outside the Volt repo (published package / global / bundled binary).
   - Open: does opencode surface LSP diagnostics into the agent's tool loop (edit results / a diagnostics
     tool), or only to a human editor? Verify the agent actually consumes them.

2. **Parity (secondary).** Even *in* the dev repo where the LSP runs, it returned `{}` for the malformed
   interface — the LSP (TypeScript, nav-focused, lenient) accepts what the bridge (C#, strict, must emit
   IEC) rejects. So once wired, the LSP must catch what the bridge will reject, or the agent still gets a
   false green light. Invariant: **LSP diagnostics ⊇ bridge rejections.**

## Decisions (tentative — to firm up when picked up)

- Fix the wiring first; parity is moot if the agent never has the LSP.
- **DECIDED & DONE — one canonical form.** The canonical interface is exactly what `volt pull`
  (`StAssembler`) emits: every method closed by `END_METHOD`, at column 0, inside `INTERFACE…END_INTERFACE`.
  That one form is enforced on **both** sides — the bridge `StSplitter` requires `END_METHOD` (unchanged),
  and the LSP parser was tightened to redline a missing one (`parser/units/interface.ts`: `pushError` when
  absent). Tested: bridge `InterfaceRoundTripTests` (canonical splits / compact throws) + LSP
  `parser.test.ts` (compact redlined / canonical clean). "Optional" was tried and reverted — one form,
  round-trip identical. (Watch-item: the bridge splitter is line/column-based while the LSP is
  token-based, so *indentation* is a separate latent divergence — canonical is column-0; revisit if it bites.)

## Delivery — validated end-to-end (prototyped, then cleaned up)

1. **Build one self-contained binary:** `bun build --compile --outfile volt-lsp-codesys[.exe]
   packages/volt-lsp-codesys/src/bin.ts` → ~95 MB, bundles the runtime + the embedded language reference.
   No `node`, no `dist/`, no `node_modules`.
2. **Register in GLOBAL config** (`$OPENCODE_CONFIG_DIR/opencode.json`, default `~/.config/opencode/`) with
   an **absolute** command: `["<abs>/volt-lsp-codesys", "--stdio"]` + the `.st`/`.itf`/… extensions. The
   path MUST be absolute — opencode spawns LSPs with `cwd = project` (`lsp.ts:174`), so a relative arg only
   resolves inside the repo. Global config merges *before* project config (`config.ts:202`), so one
   registration covers every project.
3. **Proven:** an arbitrary project (not the repo) returns `source: "volt-lsp-codesys"` diagnostics →
   `verify-desktop.ts` goes green.

Binary delivery: **desktop** bundles it beside the app (it already bundles the volt CLI); **CLI/standalone**
the installer drops it on disk + writes the global config. The `volt` **tool** follows the same shape — a
global `tool/volt.ts` (opencode scans `{tool,tools}/*.ts`, `registry.ts:174`) shelling to the bundled volt
CLI. Trade-off: per-platform builds, ~95 MB each — fine for a shipped product (predictable over small).

## Open Questions

- Delivery mechanism for the LSP binary to a consumer project (npm dep vs global vs bundled with the Volt app)?
- Does the desktop Volt app spawn opencode with the LSP configured for the *opened* PLC project's dir?
