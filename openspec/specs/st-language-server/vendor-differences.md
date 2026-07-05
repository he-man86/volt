# CODESYS vs TwinCAT — difference reference

Derived from the working implementation. The vendor resolves once at init (default `codesys`); checks branch on
`activeVendor` to mirror each compiler's exact wording, and `RULE_VENDOR_APPLICABILITY` masks checks that don't
apply. CODESYS and TwinCAT are the same IEC 61131-3 language — the per-vendor surface is small. Live re-record
(2026-07-05, 244 fixtures): **228 identical · 12 same-verdict-different-wording · 4 true verdict divergences**.

## Message-wording differences (same check, different words per vendor)

Same construct, each compiler phrases it differently — the LSP emits the exact per-vendor string. TwinCAT
systematically capitalizes (`pragma`→`Pragma`), quotes operators/section-names, and writes `Functionblock` as
one word. When vendor is unset/`auto`, all default to the **CODESYS** form.

| Construct | CODESYS text | TwinCAT text |
|---|---|---|
| MOD on a non-integer (REAL) | `MOD is not defined for REAL` | `'MOD' is not defined for 'REAL'` |
| Instantiate an ABSTRACT FB | `Function block <Name> is ABSTRACT and cannot be instantiated` | `Functionblock <Name> is ABSTRACT and cannot be instantiated` |
| FB_Init wrong/missing signature | `The FB_Init method of a function block or struct needs two inputs 'bInitRetains' and 'bInCopyCode' of type BOOL` | `An 'FB_Init'-Method of a functionblock or struct needs two inputs 'bInitRetains' and 'bInCopyCode' of type BOOL.` |
| FB_Exit wrong/missing signature | `The FB_Exit method of a function block or struct must have a single input 'bInCopyCode' of type BOOL and a return value of type BOOL.` | `An 'FB_Exit'-Method of a functionblock or struct needs an input 'bInCopyCode' of type BOOL.` |
| Implicit narrowing LREAL→REAL (warning) | `Implicit conversion from 'LREAL' to 'REAL': Possible loss of information` | `Implicit conversion from 'LREAL' to 'REAL': possible loss of information` |
| Orphan conditional pragma | `Unexpected pragma: '<dir>' found without matching 'if'` | `Unexpected Pragma: '<dir>' found without matching 'if'` |
| VAR-section kind misplaced | `VAR_TEMP declaration not allowed in this place` | `'VAR_TEMP' declaration not allowed in this place` |

Note: only the narrowing message and the two lifecycle messages carry a trailing period on the TwinCAT side.
These are the only checks that emit ONE clean message the LSP mirrors per vendor; all other CS≠TC wording lives
inside parser cascades the LSP never reproduces (see divergences).

## Vendor-only constructs

### CODESYS-only (flagged under TwinCAT by `check-vendor-only-operator`)

Runs ONLY when `activeVendor === "twincat"` (CODESYS accepts its own operators). Two message forms:
`Operator '<op>' is CODESYS-only and not supported by TwinCAT.` and `Operator '<op>' exists in TwinCAT but with
a different signature — the CODESYS form here won't compile.`

The 13 CODESYS-only system operators:

| Operator | TwinCAT | Note |
|---|---|---|
| `__QUERYINTERFACE` `__QUERYPOINTER` `__TRY` `__CATCH` `__FINALLY` `__ENDTRY` `__VARINFO` `__POSITION` `__POUNAME` | different signature | TC forms differ |
| `__CURRENTTASK` | not supported | TC: `Tc2_System.GetCurTaskIndex` |
| `__COMPARE_AND_SWAP` | not supported | TC: `TestAndSet` / `FB_IecCriticalSection` |
| `__XADD` | not supported | — |
| `__POOL` | not supported | TC uses namespace qualification / `__SYSTEM.POU` |

CODESYS-only **type** (code `vendor-only-type`): `__VECTOR` → `Type '__VECTOR' is CODESYS-only and not supported
by TwinCAT. TwinCAT has no SIMD primitive — use ARRAY[0..N-1] OF T for fixed-size containers.`

**Shared, NOT flagged** (verified live): `__NEW`/`__DELETE` (TC allocates from router memory — the old "TC has
no dynamic memory" note was wrong; portability caveats are gotchas, not diagnostics), `__ISVALIDREF`,
`TEST_AND_SET`, `INI`. Other CODESYS-only syntax the parser tolerates: backtick-escaped identifiers
(`` `TYPE` ``), partial word/byte access `dword.%W1`/`.%B`.

### TwinCAT-only
None. No TwinCAT-only operator or type produces a "not supported on CODESYS" diagnostic; the only `twincat`
reference entries are pragmas (vendor-tagged so the shared `wrong-vendor-pragma` check can flag misuse).

## Rules gated to one vendor (`RULE_VENDOR_APPLICABILITY`)

A rule absent from the map runs on **both**. After the 2026-07-05 TC realignment the map is a single entry:

| Rule | Runs on | Reason |
|---|---|---|
| `vendorOnlyOperator` | twincat only | By construction it flags CODESYS-only `__` operators — those are legal on a CODESYS workspace, so it must never fire there. |

**Formerly masked, now BOTH** (the masks were built on a broken recorder, overturned by the fresh live
re-record): `externalNonInputWrite` (live TC rejects `fb.internalVar := x` too), `abstractInstantiation`,
`doubleUnderscore`/`consecutiveUnderscores`. `missingInterfaceImplementation`/`-Signature` are kept
TwinCAT-effective in practice (192 corpus FPs from unfollowed EXTENDS-base inheritance on CODESYS) — a deferred
inheritance-resolution gap, not a vendor-applicability entry.

## Documented divergences (LSP silent where one IDE errors, or vice-versa)

Reason classes: **VERDICT** = one IDE flags where the other is silent (real capability/config gap);
**PARSE-CASCADE** = the IDE sprays 5–7 raw parser errors while the LSP emits one clean semantic message
(reproducing a cascade is neither feasible nor desirable).

### The 4 true CS↔TC verdict divergences (opposite verdicts)

| Fixture | CODESYS | TwinCAT | Why |
|---|---|---|---|
| `identifier_backtick_keyword_escape` | accept | reject | CS accepts backtick-escaped identifiers; TC rejects (`Unknown type`). LSP parser is lenient (matches CS) → silent on TC. Rejecting valid CS syntax would FP real CS projects. |
| `op_sys_new_delete` | reject | accept | CS rejects with a **runtime-config** diagnostic (`No memory for dynamic object creation defined`) — headless CS has no dynamic-memory pool. Config, not language; not source-analyzable. |
| `operand_partial_word_in_dword` | accept | reject | CS-only `dword.%W1`/`.%B`. TC parses but rejects. LSP matches TC but emits its own partial-access message. |
| `type_codesys_vector` | accept | reject | CS-only `__VECTOR`. LSP emits `vendor-only-type` under TC; TC parse-errors. |

### TwinCAT ledger (`KNOWN_DIVERGENCES.twincat`)
VERDICT: `interface_with_property` (both warn on empty property; deferred — 92 corpus properties → mass
FP) · the 3 CS-only-syntax fixtures above. PARSE-CASCADE: `identifier_double_underscore`,
`identifier_consecutive_underscores`, `deref_on_array_type`, `type_deref_non_pointer`, `var_non_retain`,
`operand_uchar_literal`, `op_sys_currenttask`, `op_sys_varinfo`, `op_sys_try_catch`, `op_sys_queryinterface`.
Other: `unresolved_identifier_in_body` (IDE 2-error cascade, LSP one message).

### CODESYS ledger (`KNOWN_DIVERGENCES.codesys`)
VERDICT: `fb_reinit_with_params` (CS-only heuristic warning; LSP defaults to TC-grade) · `op_sys_new_delete`
(runtime-config) · `operand_partial_word_in_dword` · `var_persistent` (CS warns "No VAR_PERSISTENT list…" — an
application-object-tree check, not source) · `interface_with_property` (CS "neither get nor set"; deferred) ·
`pragma_conflicting_pair` (CS "attribute 'pingroup' can only be added to variable" — attribute-target-placement
check not modeled). IDE-only-extra: `unknown_attribute_typo` + `monitoring_encoding` (CS emits an extra
`attribute … is unknown and will be ignored` lint the LSP doesn't model). PARSE-CASCADE: the `__`-system
operators + underscore/deref/retain/literal fixtures (LSP parser is more lenient on `__`-prefixed calls;
tightening risks FPs elsewhere).

### Structural facts
- CODESYS-only extra attribute lints (`… is unknown and will be ignored`, invalid monitoring encoding) are
  IDE-only extras the LSP has no single message for.
- The one non-mirrored wording class is entirely inside parser cascades; every remaining ledger entry is a
  parse-cascade or an IDE-only extra, not a wording mismatch of a message the LSP does emit.

## Suspected bridge artifacts (removed — NOT real vendor differences)

Divergences that almost certainly come from a **bridge** mis-recording, not the compilers — the two IDEs are
the same IEC language, so a "difference" here is a red flag. Removed from the ledger above; to re-verify against
a freshly-built live bridge before ever treating as real.

- **GET-only interface property.** Previously recorded as "TwinCAT requires both accessors (`no implementation
  for method '__SETVALUE'`), CODESYS accepts GET-only." IEC allows a GET-only interface property, so TwinCAT
  genuinely accepting it is expected — the rejection is almost certainly the **Beckhoff bridge** synthesizing a
  phantom `__SETVALUE` accessor (or mis-attributing the build diagnostic). Tracked as a suspected Beckhoff-bridge
  bug; the LSP does NOT model this as a vendor difference.
