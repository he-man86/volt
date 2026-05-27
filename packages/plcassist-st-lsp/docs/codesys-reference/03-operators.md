# 03 — Operators

> **Source:** https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_struct_reference_operators.html
> **Retrieved:** 2026-05-26
> **CODESYS version:** V3.5.22.0

## Summary

CODESYS V3 supports **all IEC 61131-3 operators** and adds a substantial set of CODESYS-specific extensions (prefixed `__` for system operators). All operators are recognized **implicitly throughout the project** — no library import needed.

Total: 64 operator pages. This file catalogs them by category with the key per-operator facts. Per-operator deep details (signatures, overloads) live in the linked CODESYS pages.

## ⚠ Critical quirk: overflow/underflow is target-dependent

CODESYS computes intermediate values at the target CPU's **native word size**, not the source operand type. On x86/ARM that's 32-bit, on x64 that's 64-bit. This means:

```st
VAR wVar : WORD; dwVar : DWORD; END_VAR
wVar := 65535;
dwVar := wVar + 1;       (* result: 65536 — NOT truncated to WORD *)
```

```st
VAR wVar1, wVar2 : WORD; bVar : BOOL; END_VAR
wVar1 := 65535; wVar2 := 0;
bVar := (wVar1 + 1) = wVar2;     (* FALSE on x86/ARM/x64 — 32/64-bit math *)
bVar := TO_WORD(wVar1 + 1) = wVar2;  (* TRUE — explicit truncation *)
```

**For predictable wrap-around behavior, wrap the expression in `TO_<TYPE>(...)`** to force truncation to the source data type.

This is one of the most consequential pieces of language knowledge for AI — code that "looks correct" by source-type logic does the wrong thing at runtime if overflow is involved.

## ⚠ Floating-point math is also target-dependent

Computations on `REAL`/`LREAL` produce results that depend on the target FPU. Same code can produce different floats on different controllers. Use bit-exact comparison sparingly.

## Categories

### Arithmetic

| Op | Form | URL |
|---|---|---|
| `ADD` | `a + b` or `ADD(a, b)` | `_cds_operator_add.html` |
| `SUB` | `a - b` or `SUB(a, b)` | `_cds_operator_sub.html` |
| `MUL` | `a * b` or `MUL(a, b)` | `_cds_operator_mul.html` |
| `DIV` | `a / b` or `DIV(a, b)` | `_cds_operator_div.html` |
| `MOD` | `a MOD b` | `_cds_operator_mod.html` |
| `MOVE` | `MOVE(src, dst)` | `_cds_operator_move.html` (equivalent to `:=`) |
| `INDEXOF` | `INDEXOF(<POU>)` | `_cds_operator_indexof.html` |
| `SIZEOF` | `SIZEOF(<var>)` | `_cds_operator_sizeof.html` (returns byte size) |
| `XSIZEOF` | `XSIZEOF(<var>)` | `_cds_operator_xsizeof.html` (CODESYS extension) |

### Logical / bitstring

| Op | Form | URL |
|---|---|---|
| `NOT` | `NOT a` | `_cds_operator_not.html` |
| `AND` | `a AND b` (also `&`) | `_cds_operator_and.html` |
| `OR` | `a OR b` | `_cds_operator_or.html` |
| `XOR` | `a XOR b` | `_cds_operator_xor.html` |
| `AND_THEN` | `a AND_THEN b` — short-circuit AND (ExST) | `_cds_operator_and_then.html` |
| `OR_ELSE` | `a OR_ELSE b` — short-circuit OR (ExST) | `_cds_operator_or_else.html` |

**Critical: plain `AND`/`OR` are NOT short-circuit.** Both operands are evaluated. Use `AND_THEN`/`OR_ELSE` for short-circuit (e.g., to guard a pointer dereference: `IF p <> 0 AND_THEN p^.x > 0`).

### Bit shift

| Op | Form | URL |
|---|---|---|
| `SHL` | `SHL(<val>, <n>)` — shift left | `_cds_operator_shl.html` |
| `SHR` | `SHR(<val>, <n>)` — shift right | `_cds_operator_shr.html` |
| `ROL` | `ROL(<val>, <n>)` — rotate left | `_cds_operator_rol.html` |
| `ROR` | `ROR(<val>, <n>)` — rotate right | `_cds_operator_ror.html` |

### Selection

| Op | Form | URL |
|---|---|---|
| `SEL` | `SEL(<bool>, <ifFalse>, <ifTrue>)` | `_cds_operator_sel.html` |
| `MAX` | `MAX(a, b)` | `_cds_operator_max.html` |
| `MIN` | `MIN(a, b)` | `_cds_operator_min.html` |
| `LIMIT` | `LIMIT(<min>, <val>, <max>)` | `_cds_operator_limit.html` |
| `MUX` | `MUX(<idx>, <val0>, <val1>, ...)` | `_cds_operator_mux.html` |

### Comparison

| Op | Form | URL |
|---|---|---|
| `GT` | `a > b` or `GT(a, b)` | `_cds_operator_gt.html` |
| `LT` | `a < b` or `LT(a, b)` | `_cds_operator_lt.html` |
| `LE` | `a <= b` or `LE(a, b)` | `_cds_operator_le.html` |
| `GE` | `a >= b` or `GE(a, b)` | `_cds_operator_ge.html` |
| `EQ` | `a = b` or `EQ(a, b)` | `_cds_operator_eq.html` |
| `NE` | `a <> b` or `NE(a, b)` | `_cds_operator_ne.html` |

**Note:** `=` is comparison, `:=` is assignment.

### Address operators

| Op | Form | URL |
|---|---|---|
| `ADR` | `ADR(<var>)` — pointer to var | `_cds_operator_adr.html` |
| Content (`^`) | `<ptr>^` — dereference | `_cds_operator_content_operator.html` |
| `BITADR` | `BITADR(<bit-var>)` — bit address | `_cds_operator_bitadr.html` |
| `CAL` | `CAL <FB>(...)` — call FB | `_cds_operator_cal.html` |

### Math (IEC 61131-3 standard functions)

| Op | URL |
|---|---|
| `ABS` | `_cds_operator_abs.html` |
| `SQRT` | `_cds_operator_sqrt.html` |
| `LN` | `_cds_operator_ln.html` (natural log) |
| `LOG` | `_cds_operator_log.html` (base-10 log) |
| `EXP` | `_cds_operator_exp.html` (e^x) |
| `EXPT` | `_cds_operator_expt.html` (`base ** exponent`) |
| `SIN` | `_cds_operator_sin.html` |
| `COS` | `_cds_operator_cos.html` |
| `TAN` | `_cds_operator_tan.html` |
| `ASIN` | `_cds_operator_asin.html` |
| `ACOS` | `_cds_operator_acos.html` |
| `ATAN` | `_cds_operator_atan.html` |

### CODESYS-specific system operators (all `__`-prefixed)

These are CODESYS extensions, not IEC 61131-3 standard. The `__` prefix is reserved by the language (see [10-keywords.md](./10-keywords.md)).

| Op | Purpose | URL |
|---|---|---|
| `__NEW` | Dynamic FB instantiation (requires `{attribute 'enable_dynamic_creation'}`) | `_cds_operator_new.html` |
| `__DELETE` | Dispose dynamically-allocated FB | `_cds_operator_delete.html` |
| `__ISVALIDREF` | Check that a `REFERENCE TO` is bound to a valid target | `_cds_operator_isvalidref.html` |
| `__QUERYINTERFACE` | Runtime interface test on FB instance | `_cds_operator_queryinterface.html` |
| `__QUERYPOINTER` | Runtime cast to POINTER TO | `_cds_operator_querypointer.html` |
| `__TRY`, `__CATCH`, `__FINALLY`, `__ENDTRY` | Exception handling block | `_cds_operator_try_catch_finally_endtry.html` |
| `__VARINFO` | Compile-time variable metadata access | `_cds_operator_varinfo.html` |
| `__CURRENTTASK` | Returns current IEC task handle | `_cds_operator_currenttask.html` |
| `__POSITION` | Source position (used by `implicit-parameter` pragma) | `_cds_operator_position.html` |
| `__POUNAME` | Qualified POU name (for pragma `implicit-parameter`) | `_cds_operator_pouname.html` |
| `__COMPARE_AND_SWAP` | Atomic CAS primitive | `_cds_operator_compare_and_swap.html` |
| `__XADD` | Atomic exchange-and-add | `_cds_operator_xadd.html` |
| `__POOL` | Disambiguate POUs-view from Devices-view (see [09-shadowing.md](./09-shadowing.md)) | `_cds_operator_pool.html` |
| `TEST_AND_SET` | Atomic test-and-set | `_cds_operator_test_and_set.html` |
| `INI` | Legacy initialization operator from CoDeSys V2.3 — **replaced by `FB_Init`** | `_cds_operator_ini.html` |

### Namespace operators

| Op | Purpose | URL |
|---|---|---|
| Global namespace `.` | Leading dot forces global resolution: `.ivar` | `_cds_operator_namespace_global.html` |
| GVL namespace | `gvl_name.var` | `_cds_operator_namespace_gvl.html` |
| Library namespace | `lib_name.symbol` | `_cds_operator_namespace_lib.html` |
| Enumeration namespace | `enum_name.member` | `_cds_operator_namespace_enum.html` |

See [09-shadowing.md](./09-shadowing.md) for how these interact with the search order.

## Sub-page catalog

Total: 64 sub-pages. URLs follow the pattern `_cds_operator_<name>.html`. Full list in [`_toc.json`](./_toc.json) under "Operators".

## Notes for tooling

**Already in lexer (`src/lexer/tokens.ts:172` `ALL_KEYWORDS`):**
- Arithmetic, logical, comparison operator keywords (`ADD`, `AND`, `EQ`, …)
- System operators (`__NEW`, `__DELETE`, `__VARINFO`, …) — confirm during Stage 5 cross-check
- `INI` — likely present (it's an operator keyword)

**Diagnostic candidates (Stage 5):**
- Plain `AND`/`OR` guarding a potentially-null pointer dereference → warning, suggest `AND_THEN`/`OR_ELSE`
- Integer-typed expressions where overflow may be unintended on target → low-priority warning
- `__NEW` used without `{attribute 'enable_dynamic_creation'}` on the FB → error
- Use of deprecated `INI` operator → warning ("INI is replaced by FB_Init since V3")

**Hover augmentation:**
- Hovering on any operator shows: signature, IEC vs CODESYS-extension, link to per-operator URL
- Hovering on `AND_THEN`/`OR_ELSE` shows the short-circuit semantics
- Hovering on `__NEW` shows the `enable_dynamic_creation` requirement
- Hovering on `INI` shows the deprecation notice

**Stage 5 deep-dives this into `src/reference/operators.ts`.**
