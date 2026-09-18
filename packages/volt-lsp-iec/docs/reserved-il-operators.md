# The IL operators are reserved — and reserving them needs a cascade fix first

**Measured on CODESYS 3.5.21.40, 2026-09-18.** Sixteen IL operator names cannot name a variable, each proved by its
own committed recording:

| name | fixture | CODESYS says |
|---|---|---|
| `LD` `LDN` `ST` `STN` | `cc_il_name_ld` … | `Unexpected token 'ld'` |
| `S` `R` | `cc_reserved_name_s_string`, `cc_reserved_name_r` | `Unexpected token 's'` / `'r'` |
| `ANDN` `ORN` `XORN` | `cc_il_name_andn` … | `Unexpected token 'andn'` |
| `CAL` `CALCN` `JMPC` `JMPCN` | `cc_il_name_cal` … | `Unexpected token 'cal'` |
| `RET` `RETC` `RETCN` | `cc_il_name_ret` … | `Unexpected token 'ret'` |

`CALC` is **not** on this list: `cc_il_name_calc` records a different error entirely, so nothing proves it. A keyword
added without proof rejects code the vendor accepts, which for this LSP is worse than the miss it would fix.

Today `s : STRING;` parses cleanly here and fails in the IDE — the gap runs in the worst direction.

## Why they are not in the keyword table yet

Adding all sixteen was tried and **reverted**. It works — `Unexpected token 'ld'` matches CODESYS's wording exactly —
but it costs **44 LSP-only messages** and drops CODESYS agreement from 863 to 841, because a failed DECLARATION
cascades:

```
cc_il_name_cal:  VAR cal : INT; END_VAR   cal := 1;

CODESYS   Unexpected token 'cal' found                 ← one error
ours      Unexpected token 'cal' found                 ← the same, correct
          'cal' is no valid assignment target          ← LSP-only
          Identifier 'cal' not defined                 ← LSP-only
```

The declaration never binds, so every later use of the name is undefined, and each one is reported. CODESYS stops at
the parse error. An LSP-only message is a false positive (`lsp-parity-not-better`), and 44 of them is a far larger
regression than the 16 misses they would fix.

## What has to land first

**Semantic diagnostics must not cascade from a name whose DECLARATION failed to parse.** That is worth doing on its
own account — it is not specific to IL operators. Any malformed declaration produces the same noise today, and the
only reason it is invisible is that no fixture has a malformed declaration *and* a later use of the name.

Once that holds, adding the sixteen is a one-line change to `KEYWORDS` in `src/syntax/tokens.ts` and the existing
`nameExpected` path in `cursor.ts` produces the vendor's wording unchanged. The fixtures are already committed, so
the work is verified the moment it lands: `refused.test.ts` flips those rows from deferred to asserted.
