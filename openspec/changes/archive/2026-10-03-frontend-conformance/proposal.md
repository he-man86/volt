## Why

The LSP's **front-end** — `src/syntax` (lexer, parser, AST, literal values; ~6,200 lines), `src/symbols` (binder, scopes,
library namespaces, precedence; ~1,400) and `src/types` (elementary types, inference, arithmetic, compatibility,
constant evaluation; ~1,700) — is the foundation of BOTH back-ends: the LSP's analysis and services, and the ST→Rust
transpiler (20, 8 and 21 transpiler files import it). If it is wrong, every back-end is wrong, and every back-end fix is a
workaround. The transpile review already found 6 of its 48 root causes here (`types/`: meet of mixed-sign operands,
named-constant folding, REAL constant folding, VAR_INPUT CONSTANT defaults; `syntax/`: `$00` literal decoding).

The owner's rule (2026-09-29): **the most fundamental part must be 100% right before anything is built on it.** This
change makes the front-end conform to CODESYS, measured, rule by rule — and it runs FIRST:

1. `frontend-conformance` (this change)
2. `transpile-restructure` (starts only when this change is archived)
3. the rest of the LSP review (analysis, services, server)

## What Changes

- **Measure first, mechanically,** against what we already hold: the CODESYS and TwinCAT build recordings, the run
  recordings, the six real corpora, the fixtures and the library sources.
  - Parser: every file CODESYS builds parses with zero errors; every LSP parse error matches a recorded CODESYS error;
    the printer/formatter is a fixed point on everything.
  - Symbols: every identifier in corpus + fixtures resolves; LSP "not defined / ambiguous" messages ⊆ recorded ones and
    the recorded ones ⊆ LSP's.
  - Types: every expression gets a type; where a recording decides a type (overflow, sign, width in run values; CODESYS
    type messages in build recordings), the inferred type agrees.
- **A rule catalogue, systematically, not by what comes to mind:** every grammar rule, every scope/resolution rule, every
  typing rule gets at least one fixture, recorded from CODESYS (`record:language` for accept/reject and messages,
  `record:exec` for values). A rule with no fixture is a gap.
- **Review per area, then root causes, then test-first fixes** — the same loop as the transpile review, with the
  front-end's oracle. Every root cause is pinned by a recorded fixture before it is fixed; unfixed ones are known
  divergences that fail the suite when they start matching.
- **A front-end restructure, design first:** the same analysis as the transpiler (every file, every place a concern lives, a target folder/file structure, an old → new map), then output-neutral moves — done BEFORE the conformance work, so the fixes land in the new structure.
- **An explicit front-end layer.** `syntax → symbols → types` becomes a stated layer with import rules enforced by a
  test: the front-end imports nothing from analysis, services, server, network or transpile; back-ends import the
  front-end only through its index. (Whether the folders move under a `frontend/` root is decided in design.md.)

## Non-goals

- Network text (`src/network-text`, `src/network`) — its own coverage change comes later.
- LSP features (diagnostic wording, hover, completion) — step 3.
- New language support beyond what CODESYS SP21 and TwinCAT accept.

## Impact

- `packages/volt-lsp-iec/src/{syntax,symbols,types}/**`, their tests; conformance fixtures and recordings (via the
  recorders only); `map.generated.ts` regenerates.
- Every downstream consumer may change behaviour where the front-end was wrong — that is the point; the back-end suites
  (analysis, corpus, transpile, build-conformance) must stay green or change only where a recording decides.
