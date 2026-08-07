## 0. Evidence already in hand (do not re-derive)

Measured live on CODESYS 3.5.21.40 against the corpus project, delete verified at each step:

- a PLCopen import **writes a POU's declaration**, and **`<InterfaceAsPlainText>` alone drives it** — the typed
  `<interface>` block was left stale and the plaintext still won. No ST→typed-XML generation needed.
- a POU survives export → delete → import with children intact: 4 methods / 8 properties / 3 actions, counted as
  elements in the document before and after.
- `export_xml` recursive == the old manual child-collection walk, byte-identical, and 4.6x faster.
- the CODESYS transport is in-memory (path `""`, XML returned); TwinCAT's is a temp file.

Known failure modes, to be tested BEFORE relying on them:

- an import **relocates the POU to the project root** when the parent is not passed — observed live.
- PLCopen carries **no folder membership**, so nothing in the document protects placement.

## 1. Folder preservation first — the known failure, pinned before anything depends on it

- [x] 1.1 **DONE** — `test/e2e/lifecycle/folder-preservation.test.ts`: a POU created one, two and THREE folders
      deep is edited IN PLACE (no `toFolder`) and must still be in the same folder, with the edit applied. Depth
      is the point: one level can be preserved by accident if the import's default parent happens to be right.
- [x] 1.2 **DONE** — a fourth case carries `METHOD + ACTION + PROPERTY` and asserts the children survive the
      in-place edit as well; a write that loses placement is just as likely to lose members, and both are silent.
- [x] 1.3 Gate met. Baselines MOVED, and later tasks must hold the NEW numbers, not the old ones:
      **CODESYS 96 pass / 8 skip / 0 fail** (was 92), **TwinCAT 94 pass / 11 skip / 0 fail** (was 90).

      > These pass TODAY under `WriteText` — nothing is deleted, so nothing can be relocated. That is exactly
      > why they were written first: they pin the behaviour BEFORE the mechanism changes, so a regression is a
      > red test rather than an engineer's POU quietly reappearing at the top of their project tree.

## 2. The splice surface (offline, fixture-driven)

- [ ] 2.1 `PlcOpenDocument`: set the declaration (the item's own `<InterfaceAsPlainText>`, scoped by item name —
      same discipline as `ItemBody`, since one export describes several items).
- [ ] 2.2 Set the textual body (`<body><ST>`), leaving a graphical body to the existing `SpliceFbdLdBody`.
- [ ] 2.3 Add / replace / remove a CHILD element (method, action, property incl. its accessors) by name.
- [ ] 2.4 Every one of 2.1-2.3 gets a unit test against the CAPTURED fixtures, not synthetic XML — the recorded
      CODESYS and TwinCAT exports already in `fixtures/` — so the shapes are the vendors', not mine.
- [ ] 2.5 Round-trip property: splice(parse(x)) with no change == x, normalised. A splice that rewrites bytes it
      was not asked to touch is how vendor metadata gets lost.

## 3. Route the push through it — CODESYS

- [ ] 3.1 `PushService`: for a POU, build the document once and import once, instead of root `WriteText` + per-child
      `CreateChild`/`WriteText` + orphan walk.
- [ ] 3.2 Child add/remove/rename become element operations in that document — so a partially-applied push is no
      longer reachable (today N COM mutations can half-apply; one import cannot).
- [ ] 3.3 Keep the create path on the scripting API: a POU that does not exist yet has no export to splice.
- [ ] 3.4 Keep item rename/move/delete on the scripting API — PLCopen has neither rename nor folder membership.
- [ ] 3.5 The read-only/body-format guards run BEFORE the splice, unchanged. They are what stops a textual push
      overwriting a live CFC/SFC body, and they read live IDE state, not the document.

## 4. Gate — CODESYS

- [ ] 4.1 Build + all three offline suites.
- [ ] 4.2 Live CODESYS e2e at baseline (92 pass / 8 skip / 0 fail), INCLUDING the new folder cases from §1.
- [ ] 4.3 Explicit manual check: a POU with vendor attributes/pragmas is pushed and those survive — the splice's
      whole justification over regeneration.
- [ ] 4.4 Explicit manual check: a rejected import leaves the original POU present (the delete-then-reimport
      failure window).

## 5. TwinCAT — only after CODESYS is green

- [ ] 5.1 Verify TwinCAT's IMPORT accepts a spliced POU document at all. Its transport is a temp file and it
      already answers `E_FAIL` for DUT/GVL exports, so its import is NOT assumed to mirror its export.
- [ ] 5.2 Verify children survive its round trip (element counts before/after, as done for CODESYS).
- [ ] 5.3 Verify the declaration lands on TwinCAT, and by WHICH representation — do not assume it is the plaintext
      copy just because CODESYS reads that one.
- [ ] 5.4 Live TwinCAT e2e at baseline (90 pass / 11 skip / 0 fail) plus the §1 folder cases.
- [ ] 5.5 If any of 5.1-5.3 fails, STOP and record it as a vendor limit like the DUT/GVL one — do not add a
      per-vendor write mechanism to work around it, which would recreate the seam this change exists to remove.

## 6. Close out

- [ ] 6.1 Delete whatever the change made unreachable (the per-child write path, orphan walk) — compiler-verified,
      as with the COM property walk.
- [ ] 6.2 `ARCHITECTURE.md`: state the transport rule plainly — a POU is read and written through one PLCopen
      document; structure and non-source kinds are not.
