## 1. Investigate the wiring gap (the main issue)

- [x] 1.1 Reproduced — `volt-scripts/verify-desktop.ts` points the same opencode core at a throwaway consumer project (outside the repo); volt LSP ✗ + tool ✗. Confirms the agent edits ST blind there.
- [x] 1.2 Mapped: global config merges *before* project (`config.ts:202`); LSPs spawn with `cwd=project` (`lsp.ts:174`) ⇒ the command must be **absolute**; tools scan `config.directories()` incl. the global dir; diagnostics reach the agent via the normal LSP pipeline (`diagnostics-push.ts`)

## 2. Wire the LSP into consumer projects

- [x] 2.1 **`volt setup`** (`packages/volt-git/src/setup.ts`) registers the LSP + `volt` tool in **global** opencode config with an absolute command, idempotent. Resolves binaries relative to the CLI (override `VOLT_LSP_BIN`/`VOLT_BIN` for the bundled desktop). `.js`→`node`, bare exe→runs itself, so a compiled binary drops in.
- [x] 2.2 **Acceptance test green:** `verify-desktop.ts` → volt LSP ✓ + tool ✓ in a throwaway consumer project, via `volt setup`.
- [x] 2.3 Desktop wires it **automatically** — onboarding "Initialize" → `volt init` → `setup()` (best-effort). **Handed to `desktop-distribution`:** bundle the LSP + volt CLI beside the app, point `VOLT_LSP_BIN`/`VOLT_BIN` at them, and ship the compiled (no-node) `volt-lsp-codesys` binary for customers.

## 3. LSP↔bridge diagnostic parity (secondary — from the END_METHOD bug)

- [x] 3.1 Parity test (END_METHOD case): bridge `InterfaceRoundTripTests` (canonical splits / compact throws) + LSP `parser.test.ts` (compact redlined / canonical clean)
- [x] 3.2 `END_METHOD` direction — DECIDED **one canonical form = `END_METHOD` always** (what `volt pull` emits): bridge keeps requiring it, LSP tightened (`interface.ts`) to match. "Optional" reverted.
- [x] 3.3 Indentation parity documented: canonical = column-0 (what `volt pull`/`StAssembler` emits); the line-based bridge splitter expects it, the token-based LSP tolerates indentation — benign for canonical files. Revisit only if indented hand-authored files become common.
