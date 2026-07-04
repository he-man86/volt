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

## Active triage — the 28 replay hard-failures (trusted recordings, presence mismatch)

The final full re-record (trusted ground truth) is committed; the replay now hard-fails where the LSP and
CODESYS disagree on *presence*. Only the conformance replay is affected — corpus ratchet + units stay green.
These are the LSP-debugging signal; each is fixed at root (or documented with a **verified** reason), never
silenced with a lazy `KNOWN_DIVERGENCES` entry.

- **`duplicateDeclaration`** — ✅ **root-fixed.** Was masked for CODESYS on bad ground truth; the check also
  walked the whole project + re-emitted per file → 97k corpus FPs. Fixed: scoped to the current file's unit
  scopes. Zero corpus FP; genuine case caught; replay agrees.

- **Bucket A — external write to a non-`VAR_INPUT` member (14):** `hide_var`, `noinit`, `init_on_onlchange`,
  `displaymode_{hex,bin,dec,invalid_value}`, `no_copy`, `monitoring_display`, `subsequent`, `conditionalshow`,
  `no_init_aliases`, `pragma_conflict_hide_plus_monitoring`. Each fixture's PLC_PRG does `fb.internalVar := x`;
  CODESYS rejects (`'X' is no input`). **Two roots** — (A) fix the pragma fixtures to not write internals, or
  (B) add an external-write-access check to the LSP. **DECISION NEEDED.**

- **Bucket B — vendor-applicability, checks the LSP HAS (masked on bad ground truth) (4):**
  `interface_missing_implementation`, `interface_with_property` (CODESYS: "There is no implementation for
  method…"), `identifier_double_underscore`, `identifier_consecutive_underscores` (CODESYS parse-rejects
  `__`/`foo__bar`). Re-verify each against the fresh recording + corpus → **enable for codesys** if zero-FP.

- **Bucket C — message pragmas (2):** `error_message`, `warning_message`. `{error 'msg'}`/`{warning 'msg'}` —
  CODESYS emitted the message. `messagePragmas` is TwinCAT-only on old ground truth → re-verify + enable.

- **Bucket D — pragma-attribute warnings (3):** `unknown_attribute_typo`, `monitoring_encoding`,
  `pragma_conflicting_pair`. CODESYS warns (unknown attribute / invalid value / conflicting pingroup). LSP has
  `unknownPragma` (off) + pragma checks → enable/extend, verify.

- **Bucket E — parser divergence, struct (3):** `type_dut_struct_extends`, `type_dut_struct_nested`,
  `use_struct_nested_member`. CODESYS: "Unexpected statement" — our parser accepts a struct form CODESYS
  rejects. Investigate the exact syntax (fix parser or document).

- **Bucket F — genuine new checks (2):** `oop_abstract_instantiated` (instantiating an ABSTRACT FB),
  `var_external_consumer` / `var_persistent` (VAR_EXTERNAL w/o global). New checks or documented divergence.

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
