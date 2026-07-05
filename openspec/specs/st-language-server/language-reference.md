# IEC 61131-3 language reference catalog

The complete embedded language reference, derived from the working implementation. Vendor tags: **shared** =
both CODESYS & TwinCAT · **codesys** = CODESYS-only · **twincat** = TwinCAT-only. Per-vendor differences are in
`vendor-differences.md`; source provenance (helpme-codesys.com / infosys.beckhoff.com, retrieval dates) is
embedded per reference file.

## 1. Pragmas

### Message pragmas (shared)
`text` untyped compile message · `info` message-tagged · `warning` local warning (C0373; prefer
`{attribute 'obsolete'}` for deprecation) · `error` local error.

### Conditional-compilation / region (shared)
`IF` / `ELSIF` / `ELSE` / `END_IF` (uses `defined()`, `hasattribute()`, `hastype()`) · `define` / `undefine`
(compiler-define symbols) · `region` / `end_region` (foldable source regions).

### Attribute pragmas — lifecycle / init (shared)
`call_after_global_init_slot` · `call_after_init` (after FB_Init + initial assignments) ·
`call_after_online_change_slot` · `call_before_global_exit_slot` · `call_on_type_change` ·
`global_init_slot` (init order; default POU 50000, GVL 49990).

### Attribute pragmas — hide / show (shared)
`conditionalshow` · `conditionalshow_all_locals` · `hide` · `hide_all_locals`.

### Attribute pragmas — constants (shared)
`const_replaced` (force inline) · `const_non_replaced` (keep as symbol).

### Attribute pragmas — I/O mapping / graphics (shared)
`dataflow` · `displaymode` (bin/dec/hex) · `ExpandFully` · `pingroup` (forbids pin_presentation_order_*) ·
`pin_presentation_order_inputs` · `pin_presentation_order_outputs` · `io_function_block` ·
`io_function_block_mapping`.

### Attribute pragmas — online change / persistence (shared)
`no_copy` · `noinit` (aliases `no_init`, `no-init`) · `init_on_onlchange` · `init_namespace` ·
`initialize_on_call` · `no-exit` · `no_instance_in_retain`.

### Attribute pragmas — reflection / monitoring (shared)
`reflection` (enables instance-path/is_connected scan) · `instance-path` (needs reflection + noinit) ·
`is_connected` (needs reflection) · `implicit-parameter` (pouname/position/instance-path) · `monitoring`
('variable' | 'call') · `monitoring_display` · `analysis` (SA rule suppress/enable) · `monitoring_encoding`
(UTF-8).

### Attribute pragmas — assignment / type / build (shared)
`no_assign` (error) · `no_assign_warning` · `no_check` (suppress array-bounds/div-by-zero checks) ·
`no_virtual_actions` · `obsolete` · `pack_mode` (0/1/2/4/8) · `qualified_only` (GVL/ENUM) · `strict`
(implicit conversions → errors) · `symbol` (none/read/write/readwrite) · `subsequent` · `linkalways` ·
`enable_dynamic_creation` (required for `__NEW`) · `estimated-stack-usage`.

### Attribute pragmas — strings / enums (shared)
`to_string` (enum → member name) · `ProcessValue`.

### Attribute pragmas — warnings (shared)
`suppress_warning` · `warning disable` / `warning restore`.

### Attribute pragmas — TwinCAT-only (twincat)
`TcCallAfterOutputUpdate` · `TcContextId` · `TcContextName` · `TcDisplayScale` · `TcEncoding` ·
`TcGlobalDataType` · `TcHideSubItems` (~`hide_all_locals`) · `TcIgnorePersistent` · `TcInitOnReset` ·
`TcInitSymbol` · `TcLinkTo` (alias `TcLinkToOSO`) · `TcLinkToOSO` · `TcNcAxis` · `TcNoSymbol` (alias
`tc_no_symbol`, ~`hide`) · `TcPersistent` (≈ `PERSISTENT`) · `TcRetain` (≈ `RETAIN`) · `TcRpcEnable` ·
`TcSwapDWord` · `TcSwapWord` · `Tc2GvlVarNames`.

## 2. Data types (shared)

**Boolean:** `BOOL` (1-bit logical, 8-bit storage) · `BIT` (1-bit, STRUCT/FB only, packs into bytes; CODESYS
ext; no POINTER/REFERENCE/ARRAY OF BIT).
**Integer:** `BYTE` 0..255 · `WORD` 0..65535 · `DWORD` 0..4.29e9 · `LWORD` 0..2⁶⁴-1 · `SINT` -128..127 ·
`USINT` 0..255 · `INT` -32768..32767 · `UINT` 0..65535 · `DINT` ±2.15e9 · `UDINT` 0..4.29e9 · `LINT` ±2⁶³ ·
`ULINT` 0..2⁶⁴-1 · `__UXINT`/`__XINT`/`__XWORD` (platform-portable; CODESYS ext).
**Float:** `REAL` (32-bit ~7 digits) · `LREAL` (64-bit ~15 digits).
**String:** `STRING` (1-byte/char, default 80, single-quoted) · `WSTRING` (UCS-2, double-quoted).
**Time:** `TIME` (32-bit ms) · `LTIME` (64-bit ns).
**Date/time:** `DATE` · `DATE_AND_TIME`/`DT` · `TIME_OF_DAY`/`TOD` · `LDATE` · `LDATE_AND_TIME`/`LDT` ·
`LTIME_OF_DAY`/`LTOD` (aliases are the short forms).
**Generic (ANY):** `ANY` · `ANY_NUM` · `ANY_INT` · `ANY_REAL` · `ANY_BIT` · `ANY_STRING` · `ANY_DATE` ·
`ANY_DERIVED` · `ANY_ELEMENTARY`.
**Compound / pointer-like:** `POINTER TO <t>` (`^` deref) · `REFERENCE TO <t>` (auto-deref; `:=` writes
through, `REF=` rebinds) · `ARRAY[lo..hi] OF <t>` (multi-dim; element not BIT/REFERENCE) · `OF`.
**System:** `__VECTOR[1..8] OF REAL/LREAL` (SIMD; CODESYS ext) · `VERSION` (semver struct).
DUTs `STRUCT`/`ENUM`/`UNION`/`ALIAS`/subrange are declared via `TYPE … END_TYPE` (see §7 keywords).

## 3. Operators (shared unless tagged)

**Arithmetic:** `ADD` `SUB` `MUL` `DIV` `MOD` `MOVE` `INDEXOF` `SIZEOF` `XSIZEOF`(cds).
**Short-circuit:** `AND_THEN` `OR_ELSE` (plain `AND`/`OR`/`XOR`/`NOT` are keywords, §7).
**Bitshift:** `SHL` `SHR` `ROL` `ROR`.
**Selection:** `SEL(b,f,t)` `MAX` `MIN` `LIMIT(min,v,max)` `MUX(i,v0,v1,…)`.
**Comparison:** `GT`(>) `LT`(<) `LE`(<=) `GE`(>=) `EQ`(=) `NE`(<>).
**Address:** `ADR` `BITADR` `CAL`.
**Math (IEC):** `ABS` `SQRT` `LN` `LOG` `EXP` `EXPT(b,e)` `SIN` `COS` `TAN` `ASIN` `ACOS` `ATAN`.
**System (`__`):** `__NEW`/`__DELETE` (shared; needs `enable_dynamic_creation`) · `__ISVALIDREF` (shared) ·
`__QUERYINTERFACE` `__QUERYPOINTER` `__TRY`/`__CATCH`/`__FINALLY`/`__ENDTRY` `__VARINFO` `__POSITION`
`__POUNAME` `__CURRENTTASK` `__COMPARE_AND_SWAP` `__XADD` `__POOL` (all codesys — see vendor-differences) ·
`TEST_AND_SET` (shared) · `INI` (shared, deprecated V2.3 → FB_Init).
**Namespace:** global (leading `.`) · GVL (`gvl.var`) · library (`lib.symbol`) · enum (`Enum.MEMBER`).

## 4. Type conversions (shared) — generated, not enumerated

26 participating elementary types: `BOOL SINT USINT INT UINT DINT UDINT LINT ULINT BYTE WORD DWORD LWORD REAL
LREAL STRING WSTRING TIME LTIME DATE LDATE DT LDT TOD LTOD BIT`. Patterns:
- `<SRC>_TO_<DST>(v)` — full 26×26 cross-product (incl. self-conversions).
- `TO_<DST>(v)` — one overloaded form per dest (source = ANY, inferred).
- `TRUNC(v)` REAL→DINT (V3) · `TRUNC_INT(v)` REAL→INT (discard fraction).

Encoded rules: REAL/LREAL→integer is **undefined** if out of range (target-dependent) · conversion to `BIT`
needs a BOOL-like source · V2.3 `TRUNC` returned INT (auto-replaced with `TRUNC_INT` on import) ·
acceptable-source widening (integer-family widening for INT/DINT/LINT targets; REAL↔LREAL interchangeable;
date-family members mutually acceptable; ANY accepts anything) — used to suppress false positives.

## 5. Standard functions

**IEC strings (shared):** `LEN LEFT RIGHT MID CONCAT INSERT DELETE REPLACE FIND`.
**IEC array/memory (shared):** `UPPER_BOUND(arr,dim)` `LOWER_BOUND(arr,dim)` `MOVE(in)`.
**CODESYS stdlib strings (codesys):** `STRCONCATA/W STRLENA/W STRFINDA/W STRMIDA/W STRTRIMA/W STRCPYA/W
STRCMPA/W` (A = ASCII, W = wide).

## 6. Standard function blocks (shared)

**Timers:** `TON` (on-delay), `TOF` (off-delay), `TP` (pulse) — `IN, PT → Q, ET`.
**Edges:** `R_TRIG`, `F_TRIG` — `CLK → Q` (one-cycle pulse).
**Counters:** `CTU` (up), `CTD` (down), `CTUD` (up/down) — `CU/CD, R/LD, PV → Q/QU/QD, CV`.
**Bistables:** `SR` (set-dominant), `RS` (reset-dominant) — `SET/RESET → Q1`.
Each carries the full VAR_INPUT/VAR_OUTPUT pin signature.

## 7. Keywords (shared)

**VAR sections:** `VAR END_VAR VAR_INPUT VAR_OUTPUT VAR_IN_OUT VAR_GLOBAL VAR_TEMP VAR_STAT VAR_EXTERNAL
VAR_INST VAR_CONFIG VAR_ACCESS VAR_GENERIC`.
**Modifiers:** `CONSTANT RETAIN PERSISTENT NON_RETAIN AT`.
**POU structure:** `PROGRAM FUNCTION FUNCTION_BLOCK METHOD ACTION PROPERTY GET SET INTERFACE NAMESPACE TYPE
STRUCT UNION` (+ their `END_*`), `EXTENDS IMPLEMENTS ABSTRACT FINAL PUBLIC PRIVATE PROTECTED INTERNAL THIS
SUPER`.
**Statements:** `IF THEN ELSIF ELSE END_IF CASE OF END_CASE FOR TO BY DO END_FOR WHILE END_WHILE REPEAT UNTIL
END_REPEAT RETURN JMP EXIT CONTINUE`.
**Operator-form:** `AND OR NOT XOR AND_THEN OR_ELSE MOD DIV`.
**Export-format:** `READ_ONLY READ_WRITE PARAMS`.

## 8. FB lifecycle methods (shared)

| Method | Required VAR_INPUT | Contract |
|---|---|---|
| `FB_Init` | `bInitRetains: BOOL`, `bInCopyCode: BOOL` (+ extra inputs allowed) | Implicit init before first use / online-change copy / factory download. NEVER call SUPER^.FB_Init; not a constructor; base→derived order; extra inputs set at instantiation. |
| `FB_Reinit` | (none) | Re-init after online-change copy; app-callable reset; must be implemented explicitly. |
| `FB_Exit` | `bInCopyCode: BOOL` | Pre-disposal (online change / exit / download). Derived runs REVERSE (derived→base); pointers may be stale; `{attribute 'no-exit'}` suppresses per-instance. |

All return BOOL (ignored).

## 9. Global init slots (codesys)

Defaults: **GVL = 49990**, **POU = 50000** (selecting a default is intent, not a collision). Reserved slots
(a `initSlotCollision` check flags a user POU/GVL claiming a reserved one): 123 persistent-write · 199 retain
read · 200 license metrics · 500/500 visu · 600 datasources · 1000 device/logging · 1234 app-composer · 10000
symbolic datasource · 20000 alarm · 24000–26000 visu · 30000 alarm+visu · 39900–40100 device I/O · 49980
VAR_STAT · 49985 memory manager · **49990 GVLs** · **50000 POUs** · 50000–71000 visu/datasources · 60000–60100
device+trend · 123456 unit-conversion · 150000–151000 dialogs/recipes · 200000 shutdown. (A TwinCAT companion
table is anticipated, not yet present.)

## 10. Vendor differences (CODESYS to TwinCAT)

CODESYS and TwinCAT are the same IEC 61131-3 language; the per-vendor surface is small. **Construct-level**
differences (which pragma/operator/type exists on which vendor) are the `shared`/`codesys`/`twincat` tags
throughout sections 1-9 above - those tags ARE the catalog difference. This section adds the **diagnostic-level**
differences. All of it is a single toggleable, provenance-tagged registry: each entry is individually
enable/disable-able (`verified-live` / `suspected-bridge` / `deferred`), so a difference later found to be a
bridge artifact is removed by one flag, not a code edit. When vendor is unset/`auto`, all default to the
**CODESYS** form. Live re-record (2026-07-05, 244 fixtures): 228 identical, 12 wording, 4 verdict.

### Message-wording (same check, different words per vendor)
TwinCAT systematically capitalizes (`pragma` to `Pragma`), quotes operators/section-names, writes
`Functionblock` as one word.

| Construct | CODESYS | TwinCAT |
|---|---|---|
| MOD on a non-integer (REAL) | `MOD is not defined for REAL` | `'MOD' is not defined for 'REAL'` |
| Instantiate an ABSTRACT FB | `Function block <N> is ABSTRACT and cannot be instantiated` | `Functionblock <N> is ABSTRACT and cannot be instantiated` |
| FB_Init wrong signature | `The FB_Init method ... needs two inputs 'bInitRetains' and 'bInCopyCode' of type BOOL` | `An 'FB_Init'-Method ... needs two inputs 'bInitRetains' and 'bInCopyCode' of type BOOL.` |
| FB_Exit wrong signature | `The FB_Exit method ... must have a single input 'bInCopyCode' of type BOOL and a return value of type BOOL.` | `An 'FB_Exit'-Method ... needs an input 'bInCopyCode' of type BOOL.` |
| LREAL to REAL narrowing (warn) | `... 'REAL': Possible loss of information` | `... 'REAL': possible loss of information` |
| Orphan conditional pragma | `Unexpected pragma: '<dir>' found without matching 'if'` | `Unexpected Pragma: '<dir>' ...` |
| VAR-section misplaced | `VAR_TEMP declaration not allowed in this place` | `'VAR_TEMP' declaration not allowed in this place` |

### Rules gated to one vendor
`vendorOnlyOperator` runs on **twincat only** (flags CODESYS-only `__` operators + `__VECTOR`, legal on
CODESYS). Every other check runs on **both** - the masks that once gated `externalNonInputWrite`,
`abstractInstantiation`, `doubleUnderscore`/`consecutiveUnderscores` to one vendor were built on a broken
recorder and overturned by the fresh live re-record.

### Documented divergences (LSP silent where one IDE errors)
**VERDICT** = one IDE flags, the other silent; **PARSE-CASCADE** = the IDE sprays 5-7 raw parser errors, the LSP
emits one clean message (not reproduced). The 4 true CS-to-TC verdict divergences:
`identifier_backtick_keyword_escape` (CS accepts backtick-escaped idents, TC rejects), `op_sys_new_delete` (CS
runtime-config rejection, not language), `operand_partial_word_in_dword` (CS-only `.%W`/`.%B`),
`type_codesys_vector` (CS-only `__VECTOR`). The rest is parse-cascades (`identifier_*_underscore`, `deref_*`,
`var_non_retain`, `operand_uchar_literal`, the `op_sys_*` operators) + IDE-only-extra lints CS emits
(`unknown_attribute_typo`, `monitoring_encoding` -> `attribute ... is unknown and will be ignored`).

### Suspected bridge artifacts (disabled - NOT real vendor differences)
A recorded CS-to-TC divergence is a red flag for a bridge bug. Disabled pending re-verification against a
freshly-built live bridge:
- **GET-only interface property.** Previously "TwinCAT requires both accessors (`no implementation for method
  '__SETVALUE'`), CODESYS accepts GET-only." IEC allows GET-only, so the rejection is almost certainly the
  **Beckhoff bridge** synthesizing a phantom `__SETVALUE`. Not modeled as a vendor difference.
