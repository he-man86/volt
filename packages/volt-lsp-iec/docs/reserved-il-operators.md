# The IL operator names are reserved — and they are already handled

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

**This is not about supporting IL.** Volt does not implement Instruction List and does not intend to. It is about
ST: `r : BOOL;` is a compiler error, and an LSP that accepts it silently has the gap running the worst way.

## They are reserved, by `checks/names/refused-name.ts`

All sixteen are reported today — at the DECLARATION and at every USE, with the vendor's wording and its resync
cascade:

```
VAR r : INT; END_VAR   r := 1;

Unexpected token 'r' found          ';' expected instead of ':'      Unexpected token ':' found
';' expected instead of 'INT'       Unexpected token 'INT' found     … and the same for the use
```

That landed in `b6003672d9` ("two more name families the CODESYS parser refuses — agreement 757 → 761") and
`refused-name.test.ts` holds it. **There is no gap here.**

## The keyword table is deliberately NOT the mechanism, and this is what happens if you try

An earlier version of this document said the sixteen "are not in the keyword table yet" and described adding them as
the remaining work. That is wrong twice over — they are already reserved, and the keyword table is the wrong place.
Tried on 2026-09-19, and each of these cost real time to find:

- **`LD` is the Ladder language.** `NETWORK 0 LD` names the sublanguage in a network-text header, and that parser
  required an `identifier` token — so every LD network fell through to `UNKNOWN` and took its whole body with it,
  and TwinCAT agreement with it. *(Fixed anyway: the header now accepts a keyword there, as `GET`/`SET` are names
  in ST.)*
- **`S` and `R` are the set/reset assignment operators.** `a S= b R= c` is valid CODESYS.
- **The messages DOUBLE.** With the names in the table the parser reports them and `refused-name` reports them
  again; CODESYS agreement went 863 → 849 on exactly the fourteen `cc_il_name_*` fixtures.

A semantic check can say "this name is refused here" while leaving the lexer alone. The keyword table cannot.

## What the attempt did leave behind

Two fixes worth having, both landed on their own merits:

- **A failed declaration no longer cascades.** `ParseResult.failedDeclarations` records the names a declaration
  tried to declare and could not, and `unresolved-identifier` stays quiet about them. Not IL-specific — *any*
  malformed declaration produced that noise.
- **A broken declaration is reported the vendor's way** (`reportBrokenDeclaration`): the name, then a pair per token
  to the `;`. That is the KEYWORD-table family (`Limit : INT;`), which the parser owns and which was four messages
  short of CODESYS every time.

And the test sources were renamed: 29 files declared `r`, `s`, `st` or `ld` as variables, which is ST the LSP itself
now reports. They were tests written against a language that does not exist.
