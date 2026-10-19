Requires `codesys-application-defines-spelled` tasks 2.4 and 5.2 (the shared build-property layout) built first.

## 1. Measure FIRST (stop gate: if a result contradicts the design, stop and report; never guess)

- [ ] 1.1 Live TwinCAT 4024: can a PLC folder be excluded from build, and where is it stored (`<Folder>` in the
      `.plcproj`, the `<Compile>` entries of its items, elsewhere)? Where is an item's own exclusion stored, and which
      member writes it? What does today's walk pull for an item in an excluded folder? DIALECT row.
- [ ] 1.2 Live SP21 on a corpus copy: a body written to an item in an excluded folder leaves the item's and the folder's
      build properties unchanged; the build stays clean.

## 2. CODESYS: tests red (offline)

- [ ] 2.1 An excluded folder → `<folder>/<FolderName>.folder` with the `Exclude from build` row, the folder not in
      `unreadableNodes`; its items in `items` with their own texts, none in `unreadable`. Today: folder in
      `unreadableNodes`, items in `unreadable` (`CodesysDriver.Tree.cs:112-133`).
- [ ] 2.2 A folder with defines or link-always and no exclusion → the descriptor with those rows; a folder at its
      defaults → none.
- [ ] 2.3 Push: a `set` of an item in an excluded folder is applied, not refused (`PushService.cs:92`, `:206`); a push to
      the `.folder` item is refused as read-only.

## 3. TwinCAT: tests red (offline, after 1.1)

- [ ] 3.1 An item whose exclusion is stored as 1.1 found → pulled with `%EXCLUDE_FROM_BUILD`, not unreadable. Today:
      unreadable (`BeckhoffDriver.Content.cs:112-115`). Wire parity case beside CODESYS's.
- [ ] 3.2 A push carrying `%EXCLUDE_FROM_BUILD` on TwinCAT writes it by the member 1.1 found.
- [ ] 3.3 If 1.1 found folder exclusion: an excluded folder → its `.folder` descriptor, byte-identical to CODESYS's.

## 4. LSP

- [ ] 4.1 See `lsp-excluded-from-build`, which built the own-flag half. What stays here: the folder half (`.folder` in
      `REFERENCE_EXTENSIONS`, then the folder clause in `effectivelyExcluded`), and the scope half with its live recording
      (a built program that references an FB excluded by its own flag and one excluded by its folder).

## 5. Implement

- [ ] 5.1 `ItemKind`: the folder descriptor reference kind (`.folder`, a kind word other than `folder`); docs tables
      regenerated; `bun run check` green.
- [ ] 5.2 CODESYS: the walk emits the descriptor and walks excluded folders as any folder; `ContainerRefusal` drops the
      folder case and the held-list branch.
- [ ] 5.3 TwinCAT per 1.1: `%EXCLUDE_FROM_BUILD` read and written; the `.folder` descriptor if the setting exists.
- [ ] 5.4 `scripts/completeness.known.ts`: remove only the subjects refused for an excluded folder.

## 6. Docs

- [ ] 6.1 `docs/wire.html` (`unreadable` reasons, the `.folder` descriptor), DIALECT, the `PropertyLines` doc.

## Follow-up (2026-10-19)

- [ ] TwinCAT reads `LinkAlways`, `External`, item `CompilerDefines` and `AdditionalAllocation` from the saved `.plcproj`, with the
      same save lag C39 describes for exclusion; read them from the live `ProduceXml` VSProperties as
      `twincat-exclusion-from-ide` (archived) does for `Exclude`.
