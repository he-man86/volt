## 1. Current situation

- [ ] 1.1 List every push path that parses or checks the header, per kind (POU, DUT, GVL), starting from the call
      sites in the proposal. Record what acts on push today.
- [ ] 1.2 Measure the `.fb`-with-`PROGRAM`-text case with the check off, both vendors: what does the project hold
      afterwards, and what does `refs` report?

## 2. Remove

- [ ] 2.1 Drop header parsing and the header/extension check for every TOP-LEVEL item on every push path found in 1.1
      (`StReader.Read` step 1, `PushService` `RequireKind`, `DutSubtypeChanges` subtype-vs-body): the extension is the kind.
- [ ] 2.1b Keep header parsing ONLY where a CHILD element (METHOD, ACTION, PROPERTY + GET/SET, interface members) is found
      and delimited inside its item's file; a child whose header cannot be read is refused naming the item and line.
- [ ] 2.2 Keep only what performing the push needs (the `IMPLEMENTATION` split); its refusal stays `INVALID_ST`.
- [ ] 2.3 Update the tests that assert `INVALID_CODE_HEADER` on push.

## 3. Verify

- [ ] 3.1 The `c802b74d` shape (unclosed opening comment in a DUT) pushes; a build then reports it. Same for an FB, a
      GVL and an enum with an unclosed comment; an `X.struct` whose text is an enum pushes as written.
- [ ] 3.2 Full C# suites green; e2e on both vendors.
