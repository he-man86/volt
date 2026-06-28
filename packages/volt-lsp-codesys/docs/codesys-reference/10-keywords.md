# 10 — Keywords

> **Source:** https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_keywords.html
> **Retrieved:** 2026-05-26
> **CODESYS version:** V3.5.22.0

## Summary

CODESYS keywords are reserved words that name language constructs (control flow, data types, operators, scopes, attributes). They **must be capitalized** and **cannot be used as identifiers**. The CODESYS keywords page itself does not enumerate the full list — it gives illustrative examples and notes a few "export format" keywords explicitly. The complete set must be assembled by walking the language reference (operators, variable kinds, data types, ST statements). This file is the consolidated canonical list as of the retrieval date.

## Critical rules

1. **Keywords must be uppercase.** (Source: `_cds_keywords.html`: *"In all editors, you must capitalize keywords"*.)
2. **Keywords cannot be variable names.** Direct quote: *"Keywords cannot be used as variable names."*
3. **CODESYS validates this on input** — the editor highlights misuse with a wavy underline.
4. **Double-underscore prefix `__name` is reserved** for CODESYS-generated implicit identifiers. User code may not use it. (Source: same page, tip box.)
5. **Backticks bypass rule 2** — identifiers between backticks `` ` `` (acute accent U+0600) can match keywords. See [08-identifiers.md](./08-identifiers.md).

## Full keyword catalog

Aggregated from CODESYS language reference. Organized by category. Source pages cited per group.

### Variable section keywords (from [02-variables.md](./02-variables.md))

```
VAR              END_VAR
VAR_INPUT
VAR_OUTPUT
VAR_IN_OUT
VAR_GLOBAL
VAR_TEMP
VAR_STAT
VAR_EXTERNAL
VAR_INST
VAR_CONFIG
VAR_ACCESS
VAR_GENERIC                  (* generic-constant variant *)
```

### Variable modifiers

```
CONSTANT
RETAIN
PERSISTENT
NON_RETAIN                   (* less common; pairs with RETAIN *)
READ_ONLY
READ_WRITE
AT                           (* address binding: name AT %IX0.0 *)
```

### POU & program structure keywords

```
PROGRAM          END_PROGRAM
FUNCTION         END_FUNCTION
FUNCTION_BLOCK   END_FUNCTION_BLOCK
METHOD           END_METHOD
ACTION           END_ACTION
PROPERTY         END_PROPERTY
GET              SET                  (* property accessors *)
INTERFACE        END_INTERFACE
NAMESPACE        END_NAMESPACE
TYPE             END_TYPE             (* DUT declarations *)
STRUCT           END_STRUCT
UNION            END_UNION
EXTENDS
IMPLEMENTS
ABSTRACT
FINAL
PUBLIC           PRIVATE          PROTECTED          INTERNAL
THIS             SUPER
```

### ST statement keywords (from `_cds_st_f_instructions.html`)

```
IF       THEN       ELSIF       ELSE       END_IF
CASE     OF         END_CASE                      (* + ELSE for default *)
FOR      TO         BY          DO          END_FOR
WHILE    DO         END_WHILE
REPEAT   UNTIL      END_REPEAT
RETURN
JMP                                                (* label-target jump *)
EXIT                                               (* break out of loop *)
CONTINUE                                           (* ExST: skip to next iter *)
```

### Operator keywords (from [03-operators.md](./03-operators.md))

```
NOT      AND      OR       XOR
AND_THEN OR_ELSE                                  (* short-circuit, ExST *)
MOD      DIV
ADD      SUB      MUL                              (* operator-form arithmetic *)
SHL      SHR      ROL      ROR
SEL      MUX      MIN      MAX      LIMIT
GT       LT       GE       LE       EQ       NE
ABS      SQRT     LN       LOG      EXP      EXPT
SIN      COS      TAN
ASIN     ACOS     ATAN
INDEXOF  SIZEOF   XSIZEOF
ADR      BITADR
CAL      MOVE
TRUNC    TRUNC_INT
INI
```

### System operators (CODESYS extension; reserved by `__` prefix rule)

```
__DELETE         __NEW            __ISVALIDREF
__QUERYINTERFACE __QUERYPOINTER
__TRY    __CATCH    __FINALLY    __ENDTRY
__VARINFO        __CURRENTTASK    __POUNAME
__COMPARE_AND_SWAP  __XADD       __POSITION
__POOL                                            (* POUs-view disambiguator *)
TEST_AND_SET
```

### Type conversion operators (from [04-type-conversion.md](./04-type-conversion.md))

```
BOOL_TO_INT      BOOL_TO_DINT     ...      BOOL_TO_LREAL    BOOL_TO_STRING
INT_TO_BOOL      INT_TO_REAL      ...                          (* and every other pair *)
REAL_TO_INT      REAL_TO_LREAL    ...
STRING_TO_INT    STRING_TO_REAL   ...
TIME_TO_DINT     LTIME_TO_LINT    ...
DATE_TO_*        DT_TO_*          TOD_TO_*
TO_BOOL          TO_INT           TO_REAL          ...         (* overloaded form *)
TRUNC            TRUNC_INT                                      (* REAL→INT truncate *)
```

Full per-pair list lives in `_toc.json` under "Operators for type conversion" — too long to enumerate exhaustively here. Pattern: `<src>_TO_<dst>` for every elementary type pair, plus the overloaded `TO_<dst>` form.

### Data type names (from [06-data-types.md](./06-data-types.md))

These are tokenized as type keywords. Cannot be used as identifiers.

```
BOOL
SINT     INT      DINT     LINT
USINT    UINT     UDINT    ULINT
BYTE     WORD     DWORD    LWORD
REAL     LREAL
STRING   WSTRING
TIME     LTIME
DATE     LDATE
TIME_OF_DAY  TOD              LTIME_OF_DAY    LTOD
DATE_AND_TIME    DT           LDATE_AND_TIME  LDT
BIT
ANY      ANY_INT  ANY_NUM  ANY_REAL  ANY_BIT  ANY_STRING  ANY_DATE  ANY_DERIVED  ANY_ELEMENTARY
POINTER          REFERENCE        ARRAY            OF              TO
__UXINT  __XINT   __XWORD
__VECTOR
VERSION
ENUM             (* implicit; also TYPE/STRUCT/UNION declared types *)
```

### Pragma / attribute keywords (from [07-pragmas.md](./07-pragmas.md))

These appear inside pragma blocks `{ ... }` rather than as bare identifiers, but the **names themselves** are reserved when used as pragma keys.

```
attribute        warning         region          end_region
flow             noflow          analysis        monitoring
disable          restore
```

(See pragmas section for the full attribute-name catalog like `'no_init'`, `'pack_mode'`, etc. Those names are quoted strings inside `attribute` pragmas, not bare keywords.)

### Export-format keywords (CODESYS-specific)

Per the keywords page, these appear in the CODESYS project export format and may not be used as identifiers anywhere:

```
ACTION           END_ACTION
END_FUNCTION
END_FUNCTION_BLOCK
END_PROGRAM
```

(Note: `ACTION`/`END_ACTION` are also used in POU declarations — so they're double-listed.)

### Other valid keywords (per the keywords page tip box)

```
VAR_ACCESS       READ_ONLY        READ_WRITE       PARAMS
```

## Quirks to note for the AI

1. **`AND`/`OR`/`NOT`/`XOR` are keywords, not symbols.** Unlike C-family. `a AND b` is the operator form; `&` is also valid for AND on BOOL but the keyword form is preferred.
2. **`MOD`, `DIV` are keyword operators**, not the symbols `%` or `/` (though `/` is the symbolic division operator).
3. **`TIME` literals use a `T#` or `TIME#` prefix**: `T#1s500ms`, `TIME#1d2h`. The keyword `TIME` standalone is the type name.
4. **`DT` is the shorthand for `DATE_AND_TIME`** — both are keywords. Using `DT` as a variable name (`VAR DT : INT; END_VAR`) is rejected.
5. **`SUPER^` requires the dereference operator** — `SUPER` alone is just the type; `SUPER^.method()` is the call.
6. **`THIS^.x`** similarly — `THIS` is a pointer, `THIS^` is the FB instance.
7. **`__POOL` is positionally significant** — prepending it changes which view the compiler searches first. See [09-shadowing.md](./09-shadowing.md).
8. **Property accessors `GET` / `SET`** appear inside `PROPERTY`/`END_PROPERTY` blocks; outside that context they're not keywords in a typical sense but still reserved.

## Notes for tooling

**LSP lexer status:**
- `packages/volt-lsp-codesys/src/lexer/tokens.ts:172` (`ALL_KEYWORDS`) currently enumerates ~85 keywords. **It will need to be cross-checked against this corpus** during Stage 1 — likely missing some of the system operators (`__POSITION`, `__CURRENTTASK`, `__POUNAME`, etc.) and the more exotic data type aliases (`LDT`, `LTOD`, `LDATE_AND_TIME`).
- The export-format-only set (`ACTION`/`END_*`) needs to be in `ALL_KEYWORDS` or in a semantic check, since CODESYS rejects identifiers matching them.

**Mechanically enforceable diagnostics (Stage 1):**
- Identifier matches an `ALL_KEYWORDS` entry → error
- Identifier starts with `__` → error
- Identifier with `_{2,}` somewhere in middle → error
- Identifier matches export-format-only keyword (`ACTION`, `END_ACTION`, etc.) → error
- Identifier matches a known type name that the lexer treats as identifier → error

**Stage 1 deep-dives this into `src/reference/keywords.ts` as the canonical set.**

## Sub-pages

This section has no sub-pages on the CODESYS site.
