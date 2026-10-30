> Superseded 2026-10-30: the current network-text spelling is packages/volt-cli/docs/network-text.html.

# Design

Owner, 2026-10-27: `%LANGUAGE` (option A); no line for an abstract member with no body slot; no backward compatibility
("just implement cleanly"). The four open points of proposal.md are decided here. Points 1, 2 and 4 are the main
session's calls under that instruction, flagged to the owner in the report.

## The line

`%LANGUAGE <LANG>` and `%LANGUAGE <LANG> UNSUPPORTED`. It has the same place and meaning as `IMPLEMENTATION <LANG>`
today: it ends the declaration, starts the body, its value picks the reader, and a body that contradicts it is refused
by name. `LANGUAGE` joins `PropertyLines`' closed key list, so there is one `%`-line grammar — the key in upper case,
ended by a space or a tab, as every key (and a space or a tab separates every word of a value, `%CLASS` and
`%FILE_LINK` included); the language words in any case. (Not the old line's grammar, which took its
keyword in any case: `%language ST` is no line. Flagged to the owner.) `ImplementationMarker` folds into it, and
nothing keeps a second spelling.

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
     - no line on a member the push CREATES: an ABSTRACT METHOD is created as the vendor's abstract class with no slot
       (`ObjectClass.AbstractMethod`, derived from the text by `PushService.CreateClass`: CODESYS constructs its
       `AbstractPOUMethodObject`, measured in C2r; TwinCAT has no such class and its pre-flight refuses it by name, C2n),
       so a pulled pro2193 owner migrates to a CODESYS project as pulled. Any other member with no line on a create is
       refused by name: a concrete method has a body, and a slotless accessor has no measured create (pro2193's `Busy`
       GET: its owner `VisionSystem_BaseFB` is refused until one is measured);
     - ABSTRACT dropped over a live abstract member with no slot: refused, as before (the IDE keeps the class, C2l).
   - TwinCAT's abstract members HAVE a slot and keep `%LANGUAGE ST` with an empty body. (Step 2: "as today" was not
     true — `AbstractMemberFold` folded an empty slotted ABSTRACT member into `IMPLEMENTATION NONE` on read. The fold is
     deleted with NONE, so a slotted member reads as its slot, `%LANGUAGE ST` empty, on both vendors.)
   - So the vendors give different text for one abstract member (CODESYS IDE-made: no line; TwinCAT, and a CODESYS
     slotted one: `%LANGUAGE ST` empty). It is the IDE's slot fact; whether that divergence is accepted is the owner's
     call (wire-divergence rule), not decided here.
   - A bare accessor in a POU file (`GET` … `END_GET` with no line, nothing after its declaration) is the same slotless
     form as a property's.
   - The guard judges a pushed member against the live object AFTER the push's renames, so renaming a slotless member
     is a rename, not a create.
   - Accepted price: the reader and the LSP cannot tell an empty member whose line was deleted from a slotless one.
     The push guard catches it against the live IDE.
   - Text above the line that the declaration parser does not take (`END_VAR;`, a statement) stays above the line as
     declaration text: the push writes it into the declaration as sent, and the LSP finds the line wherever it stands in
     the body tokens. What CODESYS says about such text is not recorded, so the LSP says nothing on it (an LSP-only
     message is a false positive until a recording backs it) — niche: accepted loss (0 occurrences in the corpora). A
     `%`-line there is the push's refusal (`RefusePropertyLinesIn`) and the LSP reports it as a misplaced property line.
     PLC Assist's family 4 was never reproduced, so this does not claim to fix it.
   - "Nothing after the declaration" of a slotless member means the same on both sides: after its header, only VAR
     blocks (a section keyword of the LSP's `VAR_SECTION_KEYWORDS` through its `END_VAR`, wherever either stands on its
     line) and trivia (the push, `StReader.DeclarationOnly`); every token after the parsed declaration is trivia (the
     LSP). A wrapped header with no VAR block still differs (the LSP takes it, the push refuses it) — niche: accepted loss
     (0 occurrences in the corpora).
   - The LSP marks a no-line member slotless only where the push can take one: a CODESYS ABSTRACT METHOD or an accessor
     of a CODESYS ABSTRACT PROPERTY. A no-line member that is not ABSTRACT, and any on TwinCAT, is refused by the push as a
     create and as an update, so the LSP reports it as stating no language. (A live slotless member whose declaration
     lacks ABSTRACT would be the one text the push takes and the LSP reports: 0 in the corpora — all 12 slotless members
     of pro2193 are ABSTRACT.)
   - A `%LANGUAGE` line in the declaration of a kind with no body (a GVL, a DUT, …) is refused by name
     (`StReader.RefusePropertyLinesIn`: it would be written into the IDE as code), as the LSP reports it
     (`object-properties.ts` `misplacedPropertyMessage`). The same text without the line is written whole, and the build
     reports what it holds (e2e `behaviour-changes` 4.26 / 4.26b).
4. **Network text:** the language stays the first line of a network-text body in memory (`NetworkText.LanguageOf`),
   now spelled `%LANGUAGE LD|FBD`. `docs/network-text.html` shows it.

## Not kept

`IMPLEMENTATION <LANG>` is no longer read. In a pushed file it is refused by name: "`IMPLEMENTATION` is no longer read
— pull again (it is now `%LANGUAGE <LANG>`)". That refusal is the only place the old word appears (the error table),
per the docs rule. No migration and no dual reader.

Mixed versions (4.1, decided from the owner's standing rules: protocol stays 1, no backward compatibility): an older
Volt and this one refuse each other's push BY NAME, and the release matrix's mixed-version judge accepts exactly that
refusal, unchanged (owner: "dont worry about backward comp … just implement clean for future": no version naming,
no compat code). The cell pushes each CLI's own text format, and the judge takes only a BRIDGE's rejection by
name as a refused push (`mixed-version-lib.ts` `refusedForFormat`): a CLI that fails after its push was applied is red.
No protocol bump. The workspace
materialization format moves 4 → 5 (C# `LibraryManifest.Materialization`, LSP `MATERIALIZATION`); the wire protocol
stays 1 (only descriptions in `volt-bridge.openrpc.json` change).
