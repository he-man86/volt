## Why

The volt-lsp-iec LSP is exercised almost entirely by small, hand-written in-memory fixtures. A real, full-option CODESYS project is a different beast — library-heavy, deeply cross-referenced, and using language features the fixtures never touch — and it's exactly where an LSP earns or loses the agent's trust (a single false-positive diagnostic on valid code teaches the agent to distrust *all* diagnostics). We now have such a project on hand, so we can turn it into a durable regression corpus and harden the LSP against reality instead of toy inputs.

> **Note (post `kind-based-file-extensions`):** the corpus files are **kind-named** (`.fb`/`.prg`/`.fun`/`.itf`/`.struct`/`.enum`/`.union`/`.alias`/`.gvl`), not `.st`, and the LSP scan (`walkForStFiles`) covers that kind set. Every `.st` mention below predates that change — read it as "the kind-named source files." Read-only CFC/SFC bodies materialize as a `READONLY <LANG>` marker (not analyzed).

## What Changes

- **A committed real-project conformance corpus.** Materialize the project **once** via the (headless) bridge into `.st` files, sanitize/anonymize as needed, and commit it under `volt-lsp-iec` as a disk-sourced fixture set — the first corpus that loads real `.st` files from disk rather than in-memory strings.
- **A corpus harness that loads `.st` from disk.** Extend the conformance harness so a folder of real `.st` files becomes a project-scoped workspace the query tests run against (definition/references/hover/completion/workspace-symbol/semantic-tokens), plus a whole-corpus diagnostics sweep.
- **Coverage hardening.** Every language construct the project uses parses and analyzes with **no spurious parse errors and no analysis gaps** (POUs, DUTs, GVLs, interfaces, methods/properties/actions/transitions, pragmas, and editable graphical FBD/LD surfaced as VG).
- **Precision hardening.** **Zero false-positive diagnostics** on the valid real code — tune the false-positive-prone semantic checks (unresolved-identifier, unknown/wrong-vendor-pragma, and peers) and their config defaults against library-imported symbols.
- **Performance hardening.** Cross-file indexing and interactive queries (nav/hover/completion) stay responsive on the large multi-file project, with a measured budget and any hot-path caching that needs.
- **Nav/resolution correctness.** Go-to-definition, references, hover, completion, and cross-file type resolution are correct across the whole project graph, not just within a file.
- *(Out of scope, follow-up change)* exercising the `volt-git` CLI pull/push round-trip against the same project.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `language-server`: adds requirements that the LSP is verified against a **committed real-project conformance corpus** — full coverage of the constructs it contains, **zero false positives** on valid real code, and correct cross-file resolution across the project graph — and that interactive queries meet a **performance budget** on a large multi-file project.

## Impact

- **`packages/volt-lsp-iec`** — new disk-sourced corpus fixtures + harness (`src/tests/conformance/`), snapshot baselines, and any check/config tuning under `src/semantic/checks/` + `src/lsp/config/`; possibly indexing/caching changes in `src/lsp/server/dispatch.ts`.
- **Corpus generation** — a one-time materialization step via `packages/volt-bridge` (headless CODESYS bridge) + `packages/volt-git` (pull/materialize), captured as a documented, repeatable script so the corpus can be regenerated.
- **No product-runtime behavior change for end users** beyond improved diagnostic precision/coverage; no new upstream seams (all work is fork-owned under `packages/volt-*`).
- **Inputs needed:** the CODESYS project (or a sanitized subset that's safe to commit — confirm no proprietary IP before it lands in the repo).
