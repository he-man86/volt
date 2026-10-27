# Design

Owner, 2026-10-27: `%LANGUAGE` (option A); no line for an abstract member with no body slot; no backward compatibility
("just implement cleanly"). The four open points of proposal.md are decided here. Points 1, 2 and 4 are the main
session's calls under that instruction, flagged to the owner in the report.

## The line

`%LANGUAGE <LANG>` and `%LANGUAGE <LANG> UNSUPPORTED`. It has the same grammar, place and meaning as
`IMPLEMENTATION <LANG>` today: it ends the declaration, starts the body, its value picks the reader, and a body that
contradicts it is refused by name. `LANGUAGE` joins `PropertyLines`' closed key list, so there is one `%`-line grammar.
`ImplementationMarker` folds into it, and nothing keeps a second spelling.

1. **Order:** `%LANGUAGE` is the first `%` line of a body. The object's own property lines follow it (where they
   follow `IMPLEMENTATION` today). A member's `%FOLDER` stays where it is.
2. **Interface members:** unchanged. No body, no line, as today.
3. **No body slot (owner):** a member whose IDE object has NO implementation slot (CODESYS
   `AbstractPOUMethodObject`, an abstract property's slotless accessor; DIALECT C2n) is written with NO `%LANGUAGE`
   line and no body. Its property lines (`%FOLDER`, `%CLASS`, …) CLOSE its declaration, exactly as an interface
   member's do today (`StReader.PeelPropertiesClosing`, `StWriter`'s no-boundary path): one form for every member
   without a body. Example: `METHOD ABSTRACT Run : BOOL` / `VAR_INPUT … END_VAR` / `%FOLDER Commands` /
   `END_METHOD`. `IMPLEMENTATION NONE` is gone. Rules:
   - Only a METHOD or a property accessor (GET/SET) may lack the line. A POU, an action, a transition: refused by name,
     as an unmarked body is today.
   - Code after a member's declaration with no line is refused by name ("state `%LANGUAGE <LANG>`").
   - Push guard (`BodyFormatGuard`), against the live object:
     - no line over a live member WITH a slot: refused, naming the member and `volt pull` (the lost-line case);
     - a stated language over a live slotless member: refused, as `IMPLEMENTATION ST` over NONE is today;
     - no line on a member the push CREATES: refused (CODESYS creates a slotted object).
   - TwinCAT's abstract members HAVE a slot and keep `%LANGUAGE ST` with an empty body, as today.
   - Accepted price: the reader and the LSP cannot tell an empty member whose line was deleted from a slotless one.
     The push guard catches it against the live IDE.
4. **Network text:** the language stays the first line of a network-text body in memory (`NetworkText.LanguageOf`),
   now spelled `%LANGUAGE LD|FBD`. `docs/network-text.html` shows it.

## Not kept

`IMPLEMENTATION <LANG>` is no longer read. In a pushed file it is refused by name: "`IMPLEMENTATION` is no longer read
— pull again (it is now `%LANGUAGE <LANG>`)". That refusal is the only place the old word appears (the error table),
per the docs rule. No migration and no dual reader.
