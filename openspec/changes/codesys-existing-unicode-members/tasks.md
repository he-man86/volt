## 1. Test first

- [ ] 1.1 Fixture: a CODESYS project with a function block holding a method named in CJK, created through the IDE. Record the
      CODESYS version and language it was created on.
- [ ] 1.2 Failing test: patch that FB's body; expect success and the method unchanged. Today: `ChildRefusedException` "refuses
      to create method".
- [ ] 1.3 Test: a NEW method named `Log` is still refused by the pre-flight, before the batch's first op.

## 2. Fix

- [ ] 2.1 `PushService`: ask `RefusedName` only for members not in `existing` (same kind and name).
- [ ] 2.2 `CodesysDriver.NameRefusal`: drop the "not an ASCII identifier" clause from the pre-flight, keeping only measured
      words and the measured backtick shapes. A new non-ASCII name reaches the IDE.
- [ ] 2.3 TwinCAT: check `TcCodeStore` for the same shape rule, and apply 2.1 and 2.2.
- [ ] 2.4 Update the `push-keeps-what-landed` / `bridge-refusal-review` notes that state the disproven premise.

## 3. Language server

- [ ] 3.1 Corpus case: the DUT and FB from chat `be8c6faa` (CJK identifiers, built clean by CODESYS) produce zero
      diagnostics. Today: `syntax-error` "Identifier expected instead of '点'".
- [ ] 3.2 The lexer's identifier rule accepts Unicode letters (and digits after the first), matching what the IDEs build.
      Republish `volt-lsp-iec` for PLC Assist.
