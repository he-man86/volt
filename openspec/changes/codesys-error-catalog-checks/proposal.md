## Why

The LSP's semantic checks grew ad-hoc (~15 checks); there is no authoritative list of "what a real CODESYS build catches," so coverage gaps are invisible. CODESYS publishes a complete, versioned catalog of ~220 compiler diagnostics (`C0001`–`C0587`) — each with an exact message and a minimal repro — and a live build emits every one as `Cnnnn: <message>` (e.g. a `USNT` typo → `C0077: Unknown type: 'USNT'`). That catalog is the master checklist for total check coverage, and the build log is a byte-exact conformance oracle. This change adopts both.

This **reverses** the stance recorded in `docs/codesys-reference/13-error-messages.md` ("we do not own these codes… we don't issue CODESYS codes from the LSP"). We still keep our own diagnostic `source`, but we now (a) map each of our diagnostics to the CODESYS code it mirrors, and (b) drive new checks from the catalog rather than from whatever we happened to notice.

## What Changes

- **Harvest** the ~220 per-code pages into a structured, machine-usable catalog under `docs/codesys-reference/errors/` (code, exact message template(s), category, a minimal repro we author, a one-line paraphrased cause, and our coverage status). Copyright-safe: extract only functional/interop facts (code, exact message string, category); author our own repros; paraphrase causes in one line; do not copy the docs' prose or fix text.
- **Triage** every code into: `covered` (an existing check already mirrors it), `checkable` (offline-analyzable → implement), or `ide-only` (needs a live build / library resolution → out of LSP scope, documented as such). Map each existing check to its CODESYS code(s) (e.g. `unknown-type` → **C0077**, `cannotConvert` → **C0032**, `unresolved-identifier` → its code).
- **Implement** the `checkable` codes incrementally: each gets a check module, a colocated repro test (red→green), registry wiring, and wording routed through `messages.ts`. FP-prone codes become opt-in lints; the corpus zero-FP gate stays green.
- **Conformance**: every implemented message is verified byte-identical against how BOTH IDEs actually build — recorded from the live CODESYS (`:8556`) and TwinCAT (`:8555`) `/build` output (`Cnnnn: <message>`). Unverified wording is marked `PROVISIONAL` until recorded; vendor wording may diverge (already per-vendor in `messages.ts`).
- Attach the mirrored `Cnnnn` code to each of our diagnostics (as metadata, not as our `code`), so a future code-action / hover can link the canonical CODESYS doc.

Scope: this change defines the catalog + triage + the incremental implementation loop and lands the first batch; it does **not** require all 220 checks at once.

## Capabilities

### New Capabilities
_None — this extends the existing language-server capability._

### Modified Capabilities
- `st-language-server`: adds a requirement that offline diagnostics are driven by, and traceable to, the CODESYS error catalog — each of our diagnostics maps to the `Cnnnn` code it mirrors, new checks are sourced from the catalog's `checkable` triage, and every shared message is conformance-verified byte-identical against the live IDE build for both vendors (or marked `PROVISIONAL`). The existing zero-false-positive and "IDE stays authoritative" guarantees are unchanged.

## Impact

- **Docs:** new `docs/codesys-reference/errors/` catalog; rewrite of `13-error-messages.md`'s stance section.
- **Code:** `packages/volt-lsp-iec/src/reference/` gains an error-code catalog module (consumed by checks + future code-actions); new check modules under `src/analysis/checks/`; additions to `src/analysis/messages.ts` and `config.ts` (`LintConfig`) for FP-prone codes.
- **Tests:** one colocated repro test per implemented code; the corpus zero-FP gate must stay green; conformance recordings against `:8556`/`:8555`.
- **No upstream/opencode impact** — purely additive to `volt-lsp-iec`.
