# 08 — Identifier Designation

> **Source:** https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_identifiers.html
> **Sub-source (Rules):** https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_rules.html
> **Retrieved:** 2026-05-26
> **CODESYS version:** V3.5.22.0

## Summary

Rules that govern what counts as a valid identifier — variable names, constants, POU names, methods, etc. — and recommendations (Hungarian-notation prefixes, library naming) for keeping codebases consistent. The hard rules in §"Rules" are mechanically checkable; the recommendations are stylistic and live in `_cds_recommendation.html` and its children.

## Hard rules (mechanically checkable)

1. **No spaces or special characters.** Underscore is the only non-alphanumeric character allowed.
2. **Single underscores OK; multiple consecutive underscores are not permitted.** `A_BCD` and `AB_CD` are different identifiers; `A__BCD` is invalid.
3. **Case-insensitive.** `VAR1` and `var1` refer to the same variable. Original casing is preserved on declaration but does not affect lookup.
4. **Unlimited length.** No length cap.
5. **Cannot match a keyword.** "An identifier is not permitted to be identical to a keyword." See [10-keywords.md](./10-keywords.md).
6. **Cannot be declared twice in the same local scope.** Global re-use is allowed (handled by namespace rules — see [09-shadowing.md](./09-shadowing.md)).
7. **Double-underscore prefix `__name` is reserved for system-generated identifiers.** CODESYS uses `__` for implicit code and prevents user code from using it. (Source: `_cds_keywords.html`.)

## Soft rule: backtick identifiers (CODESYS extension)

CODESYS supports backtick-quoted identifiers using the acute accent character `´` (Unicode U+0600). Between two backticks, any character is allowed except line breaks and other backticks — even keywords. The backticks **are part of the identifier**: ``var1`` and ``` `var1` ``` are different.

Example:
```st
PROGRAM PLC_PRG
VAR
  var1   : INT;
  `var1` : INT;        (* legal — different identifier *)
  `INT`  : INT;        (* legal — keyword used as identifier *)
  `var+9`: INT;        (* legal — special char inside backticks *)
END_VAR
```

This is rare in practice but exists for interop with external systems (circuit diagrams, foreign source). **The LSP must treat backticked names as identifiers and not strip the backticks during lookup.**

## Namespace / multiple-use rules

- Local identifier — declared at most once per scope.
- Global identifier — may be declared in multiple GVLs.
- **Local wins over global within a POU** when names collide.
- Global namespace operator `.ivar` forces global resolution: when a local `ivar` exists, `.ivar` refers to the global.
- GVL-qualified access: `<gvl_name>.<var>` disambiguates across GVLs.
- Library-qualified access: `<library_namespace>.<gvl_name>.<var>` for variables inside a referenced library.
- Nested libraries: `<lib0>.<lib1>.<symbol>` for transitively referenced libraries.

See [09-shadowing.md](./09-shadowing.md) for the full lookup search order.

## Recommendations (style, not enforced)

CODESYS publishes a Hungarian-notation convention (full reference: `_cds_recommendation.html` + 7 child pages). The conventions are not mandatory; the LSP should not warn on violations but can be aware of them for hover/autocomplete suggestions.

| Prefix | For | Example |
|---|---|---|
| `i` | INT | `iCount` |
| `di` | DINT | `diIndex` |
| `li` | LINT | `liTimestamp` |
| `ui`, `udi`, `uli` | UINT/UDINT/ULINT | `uiPort` |
| `x` | BOOL (chosen over `b` to avoid BYTE confusion) | `xEnable` |
| `r` | REAL | `rSetpoint` |
| `lr` | LREAL | `lrPi` |
| `s` | STRING | `sName` |
| `ws` | WSTRING | `wsLabel` |
| `t` | TIME | `tCycle` |
| `lt` | LTIME | `ltElapsed` |
| `tod` | TIME_OF_DAY | `todStart` |
| `dt` | DATE_AND_TIME | `dtTimestamp` |
| `a` | ARRAY | `aBuffer` |
| `p` | POINTER | `pNext` |
| `r` | REFERENCE | `rTarget` |
| `e` | ENUM | `eState` |
| `itf` | INTERFACE instance | `itfMotor` |
| `c` | CONSTANT | `cMaxRetries` |
| `g` | global variable | `g_iConfig` |
| `_` | member variable (implementation-private) | `_iCachedCount` |
| `S_` | safety types | `S_iCount` (SAFEINT) |

**Reserved prefixes for BOOL avoidance:** `b`, `n`, `f` are reserved by convention (not by language) to keep BOOL/BYTE/INT/FLOAT prefixes from overlapping. The LSP doesn't enforce this.

## Sub-page catalog

| Sub-page | URL |
|---|---|
| Rules | `_cds_rules.html` |
| Recommendations | `_cds_recommendation.html` |
| For variables | `_cds_identifiers_variables.html` |
| For variables in libraries | `_cds_identifiers_var_v3_library.html` |
| For DUTs | `_cds_identifiers_dut.html` |
| For DUTs in V3 libraries | `_cds_identifiers_dut_v3_library.html` |
| For POUs | `_cds_identifiers_pous.html` |
| For V3 library blocks | `_cds_identifiers_pou_v3_library.html` |
| For visualizations | `_cds_identifiers_visu.html` |

## Notes for tooling

**Mechanically enforceable in the LSP:**
- Rule 1 (no spaces/special chars) — lexer-level; can't happen in valid tokens
- Rule 2 (consecutive underscores) — **diagnostic candidate**, regex `_{2,}` anywhere in identifier
- Rule 3 (case-insensitive lookup) — already done by `lookupLocal` in `symbol-table.ts:141`
- Rule 5 (no keyword overlap) — lexer-level for true keywords; **diagnostic candidate** for cases the lexer treats as identifiers (e.g., the `ACTION`/`END_*` export-format-only set)
- Rule 6 (no duplicate local) — **diagnostic candidate**, `lookupLocal(scope, name).length > 1`
- Rule 7 (`__` prefix) — **diagnostic candidate**, regex `^__`

**Not enforceable (IDE/compiler authoritative):**
- Recommendations (Hungarian prefixes) — style, not language
- Library qualification rules — require library symbol tables we don't index

**Stage 1 diagnostics consume this section.**
