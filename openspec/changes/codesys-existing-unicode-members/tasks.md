## 1. Test first

- [x] 1.1 Fixture: a CODESYS project with a function block holding a method named in CJK, created through the IDE. Record the
      CODESYS version and language it was created on.
      Done: `test/fixtures/CodesysUnicodeMembers.3.5.21.40.project`, authored by `scripts/author-unicode-members-fixture.py`
      on CODESYS 3.5.21.40, UI `en` (re-measured in `zh-CHS`). MEASURED (DIALECT C28b): this install REFUSES a CJK method
      or POU name with the project's Compile option "Unicode identifiers" off (CODESYS's default; the zh-CHS UI refuses it
      in Chinese), and CREATES it with the option on - the option, not the version or the language, is the cause. The
      fixture switches the option on (stored as the engine stores it: a scripting save does not persist it), then the
      scripting creates make the be8c6faa FB `命令队列管理` with `从Modbus读取命令` / `区域可占用`, a CJK DUT and a
      task-called program; built 0 messages, and again after reopen.
- [x] 1.2 Failing test: patch that FB's body; expect success and the method unchanged. Today: `ChildRefusedException` "refuses
      to create method".
      Done: `test/e2e/items/unicode-members.test.ts` (live, red before: "the IDE refuses to create method
      '从Modbus读取命令' in '命令队列管理'", the field message) and `ExistingMemberNameTests` (FakeIde, red before).
- [x] 1.3 Test: a NEW method named `Log` is still refused by the pre-flight, before the batch's first op.
      Done: `ExistingMemberNameTests.A_new_method_named_Log_beside_an_existing_CJK_method_…` (nothing written, the DUT
      before it included), beside the existing `PushKeepsWhatLandedTests` 3.1 rows.

## 2. Fix

- [x] 2.1 `PushService`: ask `RefusedName` only for members not in `existing` (same kind and name).
      Done: `HeldMembers` / `Holds`, shared with `RefuseMemberCreates`; the IDE's members are read only when a name is
      refused.
- [x] 2.2 `CodesysDriver.NameRefusal`: drop the "not an ASCII identifier" clause from the pre-flight, keeping only measured
      words and the measured backtick shapes. A new non-ASCII name reaches the IDE.
      Done: the clause is narrowed, not dropped whole: `MeasuredNames.IsAsciiNonIdentifier` - an ASCII name that is no
      identifier (`2Fast`, `My-Name`, `a.b`: refused with the option on too, so still pre-flighted). A name holding any
      character past ASCII reaches the IDE; live, `1点` comes back "The name '1点' is not valid for this object." with
      nothing of the POU written.
- [x] 2.3 TwinCAT: check `TcCodeStore` for the same shape rule, and apply 2.1 and 2.2.
      Done: `BeckhoffDriver.NameRefusal` had the same clause and takes the same rule (2.1 is engine-wide). Offline
      `TcNameRefusalTests`; TwinCAT live e2e not run.
- [x] 2.4 Update the `push-keeps-what-landed` / `bridge-refusal-review` notes that state the disproven premise.
      Done: push-keeps-what-landed design.md + tasks.md, bridge-refusal-review tasks.md 3.1, DIALECT C28b.

## 3. Language server

- [x] 3.1 Corpus case: the DUT and FB from chat `be8c6faa` (CJK identifiers, built clean by CODESYS) produce zero
      diagnostics. Today: `syntax-error` "Identifier expected instead of '点'".
      Done: `parse-errors.test.ts` "a Chinese project's DUT, FB with CJK methods and their caller produce no diagnostics" -
      the fixture's three objects as pulled (red before: the lexer split every CJK name into unknown tokens). The be8c6faa
      files themselves are not in the repo; the fixture is their shape. No conformance fixture: the build-recording
      oracle's host project has "Unicode identifiers" off, where CODESYS refuses these names (C28b).
- [x] 3.2 The lexer's identifier rule accepts Unicode letters (and digits after the first), matching what the IDEs build.
      Republish `volt-lsp-iec` for PLC Assist.
      Done: `lex/chars.ts` `isIdentStart` / `isIdentCont` take `\p{L}` (and `\p{Nd}` after the first), as measured (C28b),
      pinned in `lexer.test.ts`. The option is not read: with it off the IDE's error goes unreported (a false negative,
      never a false positive). Republish `volt-lsp-iec` for PLC Assist: LEFT FOR THE OWNER.
