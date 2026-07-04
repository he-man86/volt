# Diagnostics conformance — working status

Live status of the **diagnostics-against-live-CODESYS** effort. The compiler is the oracle; the LSP is
validated against its recorded verdict. Updated as work lands. Companion to `toolchain-map.md`.

## Methodology (the loop)

1. **Recorder** (`scripts/record-language.ts`) — per test: reset the headless project to empty → push the
   fixture **+ its dependency fixtures + a PLC_PRG that instantiates it** → `/build` → record CODESYS's
   verdict `{buildSuccess, diagnostics}` as ground truth. Isolation prevents stale logic between tests.
   A **fixture guard** flags any case whose compiler verdict contradicts the declared `expectTcAccepts`.
2. **Replay** (`tests/conformance/language.test.ts`) — runs the LSP on each catalog test and hard-asserts
   `lspFlagged === recordedFlagged` (presence), snapshotting **both sides' severity + message** so any
   mismatch is visible. `KNOWN_DIVERGENCES` documents legitimate LSP≠IDE disagreements.
3. **Discovery** (`scripts/lsp-vs-compiler.ts`) — the same diff over a harvested real-project corpus.

Comparison is **presence-based, not message-text or severity equality** — deliberately: the LSP's wording
is its own, and some severities legitimately differ (see unresolved-identifier below).

## Infra status

| Piece | State |
|---|---|
| Bridge fix (signatures as items; no-ground-truth objects omitted) | ✅ landed + live-validated |
| Recorder loop (isolate → push → build → record) | ✅ proven live |
| Recorder: item in PLC_PRG scope | ✅ fixed (was written at ws root → `Unknown type`) |
| Recorder: fixture guard (verdict vs `expectTcAccepts`) | ✅ added |
| Recorder: dependency-aware isolation (deps in source **and** PLC_PRG) | ✅ added |
| Trusted full re-record committed | 🟡 in progress |

## Live agreement (fresh, dependency-aware recordings — presence, any severity)

| | count |
|---|---|
| both flagged | 15 |
| both clean | 187 |
| **LSP false positives** | **~1** (documented divergence: `dword%W1` bit-access our parser rejects) |
| CODESYS-only (LSP "missed") | ~39 → triaged below |

**Zero *real* LSP false positives.** The "misses" triage (most are NOT LSP recall gaps):

| Bucket | ~count | Disposition |
|---|---|---|
| **Vendor-applicability poisoned by old ground truth** | ~several | **fix — enable for CODESYS** (see below) |
| Fixture-design `'iX' is no input` (PLC_PRG writes an internal VAR) | ~15 | fix fixtures (or a real external-write check) |
| Documented parse-lenience (`op_sys_*`, `__`-idents) | ~6 | `KNOWN_DIVERGENCES` (parser deliberately lenient) |
| Off-by-default checks (narrowing: `operand_uchar_literal` UDINT→BYTE) | ~2 | validate + enable |
| Deliberate-message fixtures (`{error 'msg'}`) | ~2 | vendor-specific pragma |

## Key finding — RULE_VENDOR_APPLICABILITY built on bad ground truth

Several rules were marked **TwinCAT-only** with the rationale "CODESYS → CS 0", but that verification came
from the **old broken recorder** (the FB-placement bug made every build fail with `Unknown type` instead of
the real error). The fixed recorder shows CODESYS **does** flag these. Re-verify each against the fresh
recordings and enable for CODESYS where it actually flags (guard: zero new corpus FP):

- [ ] `duplicateDeclaration` — CODESYS: "A local variable named 'X' is already defined" → **enable for codesys**
- [ ] `doubleUnderscore` — CODESYS: "Unexpected token '__…'" (parse error) → re-verify
- [ ] `consecutiveUnderscores` — CODESYS: "Unexpected token 'foo__bar'" → re-verify
- [ ] `missingInterfaceImplementation` / `missingInterfaceSignature` — CODESYS: "There is no implementation for method…" → re-verify
- [ ] `messagePragmas` — CODESYS emitted the deliberate message text → re-verify

## Genuine gaps / off-by-default (to close, oracle-verified)

- [ ] Narrowing conversion (`narrowingConversion`, default-off) — validate vs recordings + corpus, then enable
- [ ] Call-argument mismatch (`callArgumentMismatch`, default-off) — same
- [ ] Fixture-design pass: the ~15 `'iX' is no input` cases — decide fixture fix vs a new external-write check

## Standing invariants

- Corpus ratchet stays zero-FP on built objects; any corpus FP → a new catalog case.
- Every check flipped on for a vendor must be re-verified against the fresh recordings AND the 4-corpus ratchet.
