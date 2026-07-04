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
| Trusted full re-record committed (242 tests) | ✅ committed |

## Learnings / code-quality follow-ups

- **Project-wide-walk footgun:** a check that walks `ctx.project` (not the current file's `parseResult`) is
  called once PER FILE, so it re-emits every project-wide finding N times and attributes them to the wrong
  document. Hit by `duplicateDeclaration` (97k corpus FPs) — now fixed. Audited the registry and found
  **`checkShadowing` had the same bug** (hidden only because it defaults off) — also fixed. Both now scope to
  the current file's unit scopes via `findScopeForUnit`. Rule: a check that emits per-declaration must iterate
  `parseResult.units`, never the whole project tree.
- **Ground truth is load-bearing:** `RULE_VENDOR_APPLICABILITY` and `KNOWN_DIVERGENCES` entries "verified"
  against the old broken recorder are suspect — the fixed recorder overturned several. Re-verify before trusting.

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

## Active triage — replay hard-failures (trusted recordings, presence mismatch)

**Progress: 28 → 24 → 9.** Closed at root: `duplicateDeclaration` (scoping), `doubleUnderscore` +
`consecutiveUnderscores` (vendor-applicability, zero-FP), `messagePragmas` + the info-severity comparison
symmetry, **and Bucket A (14 external-write tests) via the PLC_PRG harness fix + a CODESYS-only check.**
Remaining 9: interface/property (2), struct-parser (3), abstract-instantiation, var_persistent,
var_external_consumer, pragma_conflicting_pair.

### Harness fix — replay now analyzes PLC_PRG (closed Bucket A)

The recorder builds each test as `{FB + a PLC_PRG that instantiates/uses it}`; CODESYS's verdict covers the
whole build. The replay previously fed the LSP only `t.source` (the FB), so **usage-only** diagnostics
(external write `fb.internalVar := x`, which lives in the PLC_PRG body) never fired → presence mismatch.
Fix (`language.test.ts`): synthesize the same `PROGRAM PLC_PRG` from `plcPrgVar`/`plcPrgBody`, add it to the
project scope, and run diagnostics on it too. Also switched the per-test URI basename to `pouName` (the item
name), so name-from-file resolution (a GVL's name via `gvlNameFromUri`, `GVL_Name.field`) works as in
production — otherwise feeding PLC_PRG surfaced a spurious `unresolved-identifier` on `use_gvl_field_access`.

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
  CODESYS rejects (`'X' is no input`). Rule confirmed in docs (02-variables: only `VAR_INPUT` is externally
  writable). Decision: **Both** — fix the fixtures + add an LSP check.
  - ✅ **Check landed, zero-FP.** The first attempt had 10 corpus FPs — all writes to LIBRARY-signature members
    (e.g. `ModuleHandler.CompName` where the library renders `CompName` as a flattened plain `VAR` though it's
    really writable). Root: library signatures flatten sections, so their members' var-sections are unreliable.
    Fix: `isLibrarySymbol` (uri under `Library Manager`) — the check skips library members and only flags
    PROJECT-LOCAL FB writes, where sections are fully parsed. Zero corpus FP; scenario-tested.
  - ✅ **Bucket A now closes** via the PLC_PRG harness fix above (the replay analyzes the PLC_PRG body where
    the write lives). All 14 flip to agreement.
  - **CODESYS-ONLY (verified vendor divergence, not a doc assumption):** the recordings show for the SAME
    `fb.internalVar := x`, **CODESYS rejects** (build fails, "'X' is no input") but **TwinCAT ACCEPTS**
    (build clean, 0 errors) — all 13 plain-`VAR` fixtures. So the check is masked TwinCAT-off via
    `RULE_VENDOR_APPLICABILITY: externalNonInputWrite: ["codesys"]`. The mask is the *conservative* direction:
    if the divergence is ever wrong, TC just loses the check (a recall gap), never gains an FP.
  - **Scope:** flags any section that is NOT `VAR_INPUT`/`VAR_OUTPUT` (both externally writable per doc
    02-variables L81). `VAR_OUTPUT` external write is doc-legal → skipped (no fixture proves otherwise yet).
  - **⚠️ Follow-up — verify on LIVE TwinCAT:** the TC≠CS split rests on the offline TC recording (2026-07-03),
    not a doc inference alone, but the definitive check is a live `:8555` TwinCAT run. Re-verify the divergence
    (and whether TC rejects `VAR_OUTPUT`/other sections) when the TC bridge is available; adjust the mask then.
  - **Follow-up (bridge):** the signature renderer flattens VAR_INPUT/VAR_OUTPUT/properties into `VAR`. Rendering
    them faithfully would let the LSP check library members too (and is the "true" root of the section loss).

- **Bucket B — vendor-applicability (checks the LSP HAS):**
  - ✅ `doubleUnderscore`, `consecutiveUnderscores` — CODESYS parse-rejects `__`/`foo__bar`; **enabled for
    both, zero corpus FP.** `identifier_double_underscore` + `identifier_consecutive_underscores` now agree.
  - ⏸️ `missingInterfaceImplementation` / `missingInterfaceSignature` — CODESYS flags missing members, but the
    check has **192 corpus FPs, ALL in PROJECT files** (0 in library files): project FBs that satisfy an
    interface via an EXTENDS base class, whose inherited methods the check doesn't follow. This is inheritance
    resolution — real work, deferred (not over-invested). **Kept TwinCAT-only.** `interface_with_property` is a
    DISTINCT diagnostic (empty property, no get/set) the LSP doesn't have — a separate new-check gap.

- **Bucket C — message pragmas:** ✅ `messagePragmas` **enabled for both** — CODESYS emits `{error}`/`{warning}`.
  `error_message` + `warning_message` now agree. `{info}`/`{text}` (`info_message`/`text_message`) stay correct
  via a **methodology fix**: the recorder drops CODESYS info-severity noise, so the replay presence check now
  compares **error+warning only** (symmetric) instead of all severities. Corpus message-pragma diagnostics are
  author-emitted (source contains the pragma; CODESYS emits the same) → excluded from the precision (FP) count,
  not silenced.

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
