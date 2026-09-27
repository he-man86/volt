Order: measure → tests red → engine → CLI deletion → docs → live. Starts only after
`network-text-literal-nwl` has landed (both touch `Volt.Engine/Sync` and `Volt.Cli/Sync`).

## How this change is worked (the loop — every section, in order)

1. **Implement** the section's tasks, test-first. Never start a later section's work.
2. **Review** with three independent read-only lenses. Every finding needs a concrete repro (a model, a text, a
   failing assertion or a command); speculation is not a finding.
   - **data**: try to lose or corrupt a DUT, including subtype changes in both git shapes, stale versions,
     folders, a DUT beside a same-named item, library vs project DUTs, an old workspace, and TwinCAT codes
     605/606/607/623.
   - **spec**: requirement by requirement against the spec, proposal and this file. A ticked task that isn't
     done is a finding.
   - **layering**: no item-kind logic in `Volt.Cli` or the TS clients, no second classifier, no fallbacks, no
     dead code, no stale "one wire kind `dut`" comments.
3. **Fix** every confirmed finding: failing test first, then the product fix, then keep the test. A finding shown
   wrong is skipped with the reason.
4. **Repeat** 2–3 until a round finds nothing new, at most 3 rounds. If the cap is hit, say so; don't call it
   clean.
5. **Commit** once everything is green. Tick only what is done and tested, and mark BLOCKED tasks with the exact
   reason. Stage explicit paths only (never `git add -A`). Don't push.

Live-IDE tasks use `ide.ps1` fixtures on both vendors. If an IDE truly cannot come up, the task stays unticked as
BLOCKED; it is never faked.

## 1. Measure (live, both vendors — `pwsh packages/volt-cli/scripts/ide.ps1 up -Vendor codesys|twincat`)

- [ ] 1.1 Today's behaviour, recorded before any change: rewrite a fixture STRUCT as an ENUM in the workspace; push
      (a) with git detecting a rename, (b) as delete + add (`git rm` + new file, similarity < 50%). Record ops sent
      and the IDE result. Expected today: (a) works through `.dut`, (b) delete-then-create — record whether the
      DUT's folder, and on CODESYS its object GUID, survive.
- [ ] 1.2 TwinCAT: the tree code after writing an enum body into a 606 (struct) DUT in place — does it become 605?
      Does `refs` still see it (the 605/606/607 → dut mapping)? Same for struct → union (607) and → alias.
- [ ] 1.3 CODESYS: writing an enum body into an `IDUTObject` created as a structure — accepted in place, or does it
      need `create_dut` again? (Decides whether "update" is possible at all; if not on a vendor, that vendor's
      update is delete + create below the seam, still ONE op on the wire — record it in DIALECT.md.)
- [ ] 1.4 Grep every wire consumer for `.dut` (C#, TS e2e client, volt-control, the LSP's data model) and list them
      in this file; each is a task in group 3 or 4.

## 2. Tests red first

- [ ] 2.1 Engine: `Materializer` names each of the four DUT shapes by subtype (struct, enum, union, alias,
      text-list enum on CODESYS) — replace the `.dut` expectations in `DutSubtypeCodeTests` / `ItemKindTests`.
- [ ] 2.2 Engine: `PushService` against `FakeIde` — rename op struct→enum is one content update (folder kept,
      version gate honoured); delete + create pair coalesces; stale `ifVersion` on the delete refuses; two sets on
      one bare DUT refuse `BAD_REQUEST`; a delete of `X.struct` with NO paired set still deletes.
- [ ] 2.3 Engine: `TransportMatrixTests` / `WireVocabularyGuardTests` — no `.dut` on any wire message.
- [ ] 2.4 CLI: `DutSubtypeFileTests` rewritten as "file name == wire name" (no declaration read on pull);
      the IdeTree stale-subtype case (pull after the IDE changed struct→enum) removes `X.struct` and writes
      `X.enum` through the ordinary sweep.
- [ ] 2.5 CLI: sidecar with a `.dut` key → refused, names `volt pull`, sends nothing.
- [ ] 2.6 Library: a library enum and a project enum carry the same extension, from the same `DutSubtype`.

## 3. Engine

- [ ] 3.1 `Materializer.FullWireName`: DUT → `CodeHelper.DutSubtype(text)` extension. The only minting site.
- [ ] 3.2 `PushService`: the subtype-change rule (spec requirement 2), placed with the other op normalisation,
      before `InFolderDepthOrder`. Resolve every DUT op to its bare name once; kind check accepts all four.
- [ ] 3.3 `ItemKind`: delete `WireExtFor`, `IsDutFileExtension`; `SourceKindExtensions` lists
      struct/enum/union/alias as ordinary source extensions mapping to `Kinds.Dut`; `ExtFor(Kinds.Dut)` is no
      longer a wire extension (delete or make it throw — nothing may mint `.dut`). Rewrite the long comments at
      `ItemKind.cs:34` and `:299` to the new fact.
- [ ] 3.4 `LibSignatureRenderer`: use `DutSubtype`-equivalent naming from one helper (no second classifier).
- [ ] 3.5 Drivers: confirm neither bridge parses a wire extension to decide DUT-ness beyond `Bare()`; fix any that do.

## 4. CLI — delete, don't move

- [ ] 4.1 `Materialize.FileNameFor` → gone; pull writes `item.Name`.
- [ ] 4.2 `Extensions.FullNameFromPath` → the DUT branch gone.
- [ ] 4.3 `IdeTree.cs:66-80` stale-subtype guard deleted (the library exclusion beside it stays).
- [ ] 4.4 `Commands.cs` refusal text and `Scaffold.cs` doc: "the extension names what it is" — no "maps to .dut".
- [ ] 4.5 `Sidecar` load: refuse a `.dut` key (2.5).
- [ ] 4.6 grep `Volt.Cli` for `Dut`/`dut` — zero hits outside the sidecar refusal.

## 5. Docs and gates

- [ ] 5.1 `docs/items.html` regenerated (`VOLT_WRITE_DOCS=1`), `wire.html`, `RefsFetch.cs` example, DIALECT.md.
- [ ] 5.2 `volt-control/src/state/files.ts`, `volt-lsp-iec/src/source-extensions.ts` comments; `bun run check`
      (extension parity) green.
- [ ] 5.3 Release note: run `volt pull` once after upgrading (sidecar rebuild); files on disk unchanged.

## 6. Live

- [ ] 6.1 Re-run 1.1 on both vendors with the new build: both git shapes land as one update; folder kept.
- [ ] 6.2 e2e: `vendor-parity`, `name-clash`, `crud-cycle`, `kinds/top-level` green on both vendors.
- [ ] 6.3 Full C# suites + `bun test test/unit` green; archive, delete the recreated `openspec/specs/`.
