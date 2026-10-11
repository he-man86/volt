## 1. Measure

- [ ] 1.1 The abstract PROPERTY accessor's slot on CODESYS (`vendor-facts` `merged-classes`, `implementation.busyget`)
      and an abstract method's and accessor's slot on TwinCAT (a `vendor-facts` row, never a probe script).
  - CODESYS half measured 2026-10-11 (`vendor-fact-probe` gate 3): the abstract method and the abstract property's
    GET (`InterfacePropertyAccessorObject`) both have NO `Implementation`. TwinCAT open.

## 2. Design

- [ ] 2.1 Decide the text form that tells "no body slot" from "empty body" on both vendors (proposal, What Changes),
      and whether the LSP parser changes with it.

## 3. Fix

- [ ] 3.1 Un-skip `CodesysAbstractMemberPushTests` (red: the refusal above); the TwinCAT twin if 1.1 finds the same.
- [ ] 3.2 The fix at the producer; DIALECT C2n updated; a live e2e round trip of an abstract member on CODESYS.
