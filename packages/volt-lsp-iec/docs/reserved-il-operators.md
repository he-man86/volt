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

## What has landed, and what the blocker actually is now

**2026-09-19.** Two of the three obstacles are gone, and the third is not the one this document named.

**The cascade is fixed.** `ParseResult.failedDeclarations` records the names a declaration tried to declare and
could not, and `unresolved-identifier` stays quiet about them — which also silences "'cal' is no valid assignment
target", since that comes from `unknown-source` and only fires once an earlier check has EXPLAINED the hole. Adding
the sixteen now produces **no LSP-only messages at all**: the false-positive gate passes. That was the 44.

**`LD` IS THE LADDER LANGUAGE.** `NETWORK 0 LD` names the sublanguage in a network-text header, and the header's
parser required an `identifier` token — so the moment `LD` became a keyword every LD network fell through to
`UNKNOWN` and took its whole body with it, taking TwinCAT agreement down with it too. The language word is
contextual, exactly as `GET`/`SET` are names in ST, and the parser accepts a keyword there now.

**What stops it now is the vendor's own parse recovery.** For `VAR ld : INT; END_VAR  ld := 1;` CODESYS emits TEN
messages and we emit SIX of them — every one correct, none extra:

```
IDE  Unexpected token 'ld' found        x2      LSP  same
IDE  ';' expected instead of ':='               LSP  same
IDE  Unexpected token ':=' found                LSP  same
IDE  ';' expected instead of '1'                LSP  same
IDE  Unexpected token '1' found                 LSP  same
IDE  ';' expected instead of ':'                LSP  MISSING
IDE  Unexpected token ':' found                 LSP  MISSING
IDE  ';' expected instead of 'INT'              LSP  MISSING
IDE  Unexpected token 'INT' found               LSP  MISSING
```

The four missing ones are all from the DECLARATION: CODESYS reports the `:` and the `INT` after the bad name as
unexpected in their own right, where our declaration parser reports the name once and resyncs to the `;`.

**That recovery is fixed too** (`reportBrokenDeclaration`). With all three in place the sixteen were added and
measured: **agreement stays at 863 CODESYS and 265 TwinCAT — no regression at all.** The conformance tier is green
with them in.

**What stopped it landing is the unit tests.** Thirty-seven src test files declare `r`, twenty-nine declare `s`,
twenty declare `st`, four declare `ld` — as variable names, in embedded ST that CODESYS would reject. They are
tests written against a language that does not exist, and they all have to be renamed first. A mechanical rename
over string literals was tried and over-matched (it renamed TypeScript identifiers inside template literals);
doing it properly means going file by file, which is its own change rather than a step in this one.

So the order is now: **rename the test sources, then add the sixteen.** Everything else is done, and the addition
itself is the one-line change to `KEYWORDS` this document always said it was.

## What had to land first (as written 2026-09-18)

**Semantic diagnostics must not cascade from a name whose DECLARATION failed to parse.** That is worth doing on its
own account — it is not specific to IL operators. Any malformed declaration produces the same noise today, and the
only reason it is invisible is that no fixture has a malformed declaration *and* a later use of the name.

Once that holds, adding the sixteen is a one-line change to `KEYWORDS` in `src/syntax/tokens.ts` and the existing
`nameExpected` path in `cursor.ts` produces the vendor's wording unchanged. The fixtures are already committed, so
the work is verified the moment it lands: `refused.test.ts` flips those rows from deferred to asserted.
