# Diagnostics conformance — working status

Live status of the **diagnostics-against-live-CODESYS** effort. The compiler is the oracle; the LSP is
validated against its recorded verdict. Updated as work lands. Companion to `toolchain-map.md`.

## ✅ CLOSED — TC realignment complete (2026-07-05)

**Both bridges live: CODESYS :8556, TwinCAT :8555.** The conformance replay (`language.test.ts`) is
**GREEN on both vendors** (0 hard-fails). Full package suite 3428 pass / 0 fail, corpus precision 0.

**Big finding confirmed — the old TC snapshot was WRONG.** The `expected-tc.json` from 2026-07-03 came
from a stale bundled bridge. The fresh LIVE TwinCAT re-record (244 tests, 2026-07-05T12:00Z) shows
**TC ≈ CS**: of 244 fixtures, **228 identical (verdict+messages), 12 same-verdict-different-wording, only
4 true verdict divergences.** TC **rejects** external-write (`'X' is no input`) and abstract instantiation
exactly like CODESYS — the old vendor masks were over-masking on bad data.

**What landed:**
- `rule-vendor-applicability.ts` — `externalNonInputWrite` + `abstractInstantiation` are BOTH-vendor now
  (only `vendorOnlyOperator: ["twincat"]` remains, and that's by design). Masks effectively collapsed.
- `record-language.ts` — `VENDOR = 8555 ? "tc" : "codesys"` filename fix (replay reads `expected-tc.json`).
- **19 fixtures' `expectTcAccepts` realigned** to the fresh live-TC verdicts (14 external-write + 2 pragma-
  attribute + backtick + implicit-parameter flipped `true→false`; `interface_with_property_impl` `false→true`).
- **Deleted `implicit_parameter_pouname`** — it tested `{attribute 'implicit-parameter' := 'pouname'}`, a
  NON-feature both IDEs ignore (`unknown and will be ignored`) then reject for the missing arg. Not a pragma
  test, just an un-modeled call-argument-count case. Reintroduce under `callArgumentMismatch` if that lands.
- `KNOWN_DIVERGENCES` reconciled: added `identifier_backtick_keyword_escape` (true CS-accept/TC-reject) and
  `interface_with_property` (empty-property gap, same verified defer-reason on both) to `twincat`; dropped the
  stale `implicit_parameter_pouname` from `codesys`.
- New `scripts/diff-vendors.ts` (`bun run diff:vendors [--messages]`) — CS-vs-TC recording diff on demand,
  no re-record. This is how the 4-divergence / 12-wording split above is produced.

**The 4 true CS↔TC verdict divergences** (all `KNOWN_DIVERGENCES`; LSP tolerates rare-but-valid syntax
rather than false-positive on real projects):

| fixture | CODESYS | TwinCAT | why |
|---|---|---|---|
| `identifier_backtick_keyword_escape` | accept | reject | CS backtick-escaped idents; TC has none |
| `op_sys_new_delete` | reject | accept | headless-CS has no dynamic-memory pool (config, not language) |
| `operand_partial_word_in_dword` | accept | reject | CS-only `.%W`/`.%B` partial access |
| `type_codesys_vector` | accept | reject | CS-only `__VECTOR` SIMD type |

**Message wording is NOT byte-identical (deliberate, presence-based comparison):** 12 fixtures share the
verdict but differ in text — TC capitalizes (`token`→`Token`, `pragma`→`Pragma`), writes `Functionblock` as
one word, quotes identifiers (`MOD`→`'MOD'`). The LSP's own wording is often clearer than either compiler's;
matching text would mean per-vendor message templates (CS≠TC) for zero user benefit. Keep presence-based.

**Bridge-robustness work THIS session (all committed, separate from the above):**
- `092ae1015` empty-body-clear fix (TwinCAT parity). `b0d76c35b` + `d0a4aa4ba` + `579d110c4` — coverage +
  structure-agnostic tests. Confirmed **zero API/CLI differences on both bridges**: bridge e2e 65/65 both,
  volt-git live 17+37 both. `item-kinds.json` vocabulary drift fixed. `toFolder:""` per-vendor placement is
  INTENTIONAL (don't "fix" it) — tests made structure-agnostic instead.

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

**Progress: 28 → 24 → 9 → 6.** Closed at root: `duplicateDeclaration` (scoping), `doubleUnderscore` +
`consecutiveUnderscores` (vendor-applicability, zero-FP), `messagePragmas` + the info-severity comparison
symmetry, **Bucket A (14 external-write tests) via the PLC_PRG harness fix + a CODESYS-only check,** and
**Bucket E (3 struct tests) via the one-DUT-per-item fixture split + re-record.**
Remaining 6: interface/property (2), abstract-instantiation, var_persistent, var_external_consumer,
pragma_conflicting_pair.

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

- **Bucket E — struct (3):** ✅ **root-fixed — was a FIXTURE artifact, not a parser bug.** The 3 fixtures
  crammed TWO `TYPE…END_TYPE` DUTs into one item; CODESYS is one-DUT-per-item, so the second block is
  "Unexpected statement" (cascading into "Unknown type"). TwinCAT tolerated it; the LSP correctly parses
  multi-unit ST source. Both STRUCT `EXTENDS` (doc 06 L299) and nested STRUCT (L298) are valid CODESYS when the
  base/inner is its OWN item. Fix: split base/inner into separate fixtures (padded to 2 members to sidestep
  the doc's <2-member rule); the recorder's dep scan pushes each as its own item; re-recorded → all 6 build
  clean; the LSP was already clean (resolves inherited + nested members) → agree.

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

## Message mirroring — LSP text == IDE text (2026-07-05)

Goal: where the LSP and the compiler flag the SAME code, the LSP's message should read IDENTICALLY to the
IDE's, so an engineer sees the same words in the editor and the build pane. Principle: **mirror the IDE,
don't out-do it** — drop the LSP's extra variable-naming / fix-suggestion detail in favour of the compiler's
exact wording.

**Enforced, not eyeballed.** `language.test.ts` now hard-asserts the LSP's error+warning *message set* equals
the recording's, per vendor. `KNOWN_MESSAGE_DIVERGENCES[vendor]` lists every fixture we do NOT mirror, each
with a reason — **that set is the mirror backlog; shrinking it is the work.** Distinct from
`KNOWN_DIVERGENCES` (presence — whether the LSP flags at all).

**Mirrored so far:** external-write (`'X' is no input of '<FB>'`, ~13 fixtures) · the type-mismatch family via
the shared `cannotConvert(from,to)` helper in `checks/_shared.ts` (`Cannot convert type 'X' to type 'Y'` —
conversion-call, assignment narrowing, BOOL-in-arithmetic) · duplicate-declaration (`A local variable named
'X' is already defined in '<POU>'`) · vendor-only-operator simplified (dropped the `Tc2_System.…` advice).

**Backlog (the exception set), by why-not:**
- **CS≠TC wording (14):** the two compilers word these differently (`Token`/`token`, `Functionblock`, quoting),
  so one LSP message can't match both → needs **per-vendor message templates** (the LSP is vendor-aware). Open.
- **Parse cascades (`op_sys_*`):** the IDE emits raw parser errors from failing to parse a CODESYS-only
  operator; the LSP emits one clean semantic message. Not feasible/desirable to fake — leave.
- **Severity-gated (`unresolved_identifier_in_body`):** IDE errors, LSP warns. Flip to error only once the 13
  corpus library-blind FPs (pro2193: 3, bakon-nano: 10) are driven to 0 — else it ships false-positive errors.
- **CODESYS-only extra warnings (`unknown_attribute_typo`, `monitoring_encoding`):** CODESYS emits an
  `attribute … is unknown and will be ignored` lint the LSP doesn't model → a new attribute-lint check.
- **`interface_missing_implementation`:** mirrorable, but CODESYS UPPERCASES the method/interface names
  (`'COMPUTE'`, `'ITF_LANG_WITH_METHOD'`) — a byte-exact mirror shows uppercase in the editor. Casing decision.
- **`literal_string_to_int_assignment`:** IDE renders the literal source type as `STRING(INT#<len>)`; our
  inference yields plain `STRING`. Needs literal-length rendering.

## Standing invariants

- Corpus ratchet stays zero-FP on built objects; any corpus FP → a new catalog case.
- Every check flipped on for a vendor must be re-verified against the fresh recordings AND the 4-corpus ratchet.
- **Message text is a tested invariant:** a check that emits a diagnostic the IDE also emits must match its
  wording (via `cannotConvert` and friends) or be listed in `KNOWN_MESSAGE_DIVERGENCES` with a reason.
