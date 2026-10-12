## 0. Census

- [ ] 0.1 Schema census per item kind, per vendor (runs BEFORE `ld-fbd-coverage`, owner 2026-10-12: the item frame and
      contract are the foundation the LD/FBD build sits on; NWL members inside a body are out of scope here). CODESYS: every
      class the six corpora hold (POU classes incl. check functions, method/property/accessor classes, DUT and text-list
      enum, GVL/NVL/persistent/parameter list, task, library-manager item, device, text list, visualization) — every
      serialized member and every object-level property (build properties, comment, flags). TwinCAT: every attribute and
      element of `.TcPOU/.TcDUT/.TcGVL/.TcIO/.TcTTO` and the `.plcproj` per-item entries (ExcludeFromBuild, LinkAlways,
      SubType, SpecialFunc). Each member's value distribution over the corpora. A measure, not a probe script.
- [ ] 0.2 The read/write inventory (the 2026-10-12 audit, proposal) as file:line in design.md, completed by 0.1.

## 1. Design

- [ ] 1.1 design.md: the disposition table — every member → spelled (its text form) / editor cache (its measurement) /
      refused by name; default SPELLED; 0-occurrence members decided too. The new `%`-line forms listed for the owner's
      close report.
- [ ] 1.2 The contract: an `ObjectProperties` carrier on `ItemContent` and `Member`; the `%`-line grammar (St reader,
      writer and the LSP's format layer); task `External event:` and call comments; transition member blocks.
- [ ] 1.3 The measurements as `vendor-facts` rows, both vendors: `tc-special-classes`, `tc-dut-create-reload`,
      `tc-itf-accessor-decl`, `create-each-class`, `member-order`, `trailing-newline-cache`, `folder-order`,
      `watchdog-off-values`, `abstract-member-equivalence`; DIALECT rows updated.

## 2. Oracles, red first

- [ ] 2.1 A completeness oracle per item kind: vendor object → text → push into a blank copy → re-read reproduces every
      non-cache member; a member the table does not list fails by name.
- [ ] 2.2 Red tests, one per audit finding (proposal 1-8), on FakeIde and on live e2e fixtures (CheckBounds, NVL, persistent
      list, text-list enum, abstract member rename, excluded POU, ExternalEvent task, call comment, transition).
- [ ] 2.3 A wire-parity gate: the same declaration gives byte-identical text on both vendors (stub manifests, library
      SYSTEM, interface accessors).

## 3. Build (refactor freely — owner)

- [ ] 3.1 The contract and the text format (engine, St reader/writer, the LSP format layer).
- [ ] 3.2 CODESYS driver: read and write every spelled member; classes kept on create, or refused by name.
- [ ] 3.3 TwinCAT driver: the same; TaskDef members; library SYSTEM read; interface accessor declarations.
- [ ] 3.4 Push: member re-type/rename keeps the object where the vendor allows, else refused by name.
- [ ] 3.5 Every fallback of proposal (8) deleted — refused or spelled.

## 4. Close

- [ ] 4.1 Docs regenerated (`VOLT_WRITE_DOCS=1`) and the prose of `items.html`, `driver.html`, `wire.html` rewritten;
      ARCHITECTURE.md (142-148, 220, 225, 396) and DIALECT current.
- [ ] 4.2 Re-pull the six corpora on both vendors and diff: exactly the new spellings appear; e2e on both vendors (SP21 +
      TwinCAT together, so the parity suite runs); engine/driver/CLI suites and the full LSP suite cold green.
- [ ] 4.3 The close report lists every new text form for the owner; archive.
