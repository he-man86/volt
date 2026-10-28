## 1. Pin the receipt

- [ ] 1.1 `FakeIde`: a delete that reports success and keeps the item (the CODESYS delete-child shape).
- [ ] 1.2 Test: that delete lands per the push, and its path is not in `removed`.
- [ ] 1.3 Test: a landed delete of an item under a receipt-walk `unwalkedFolders` entry is not in `removed`; fix
      `Receipt.Gone` if it is.
- [ ] 1.4 Decide how the push states a delete that did not take (conflict code, or `newItems`), document it in the
      `push` outcomes.

## 2. Docs

- [ ] 2.1 `push` outcome sentence: `removed` names only paths the receipt walk read and no longer holds.
