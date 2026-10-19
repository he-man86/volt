## 1. Measure (stop gate: if a result contradicts the design, stop and report; never guess)

- [ ] 1.1 Live TwinCAT 4024, a PLC project with "Compiler defines" `A`: does `{IF defined(A)}` compile its branch, and does
      clearing the define drop it? Yes → TwinCAT tasks (3.x) proceed. No → stop and report. DIALECT row.
- [ ] 1.2 Corpora census (offline, from the recorded pulls): how many CODESYS applications have a build property off its
      defaults, and which fields. Expected: the defines only; any other set field is spelled by the shared layout.

## 2. CODESYS: tests red (offline)

- [ ] 2.1 An application with define `A` → `<app root>/<AppName>.application` with the `Compiler defines` row, and the
      application not in `unreadableNodes`. Today: in `unreadableNodes` (`CodesysDriver.Tree.cs:112-118`).
- [ ] 2.2 An application with undefines and a set flag → those rows, in the layout's order; a build property at its
      defaults → no item.
- [ ] 2.3 A push to the item → refused as a read-only descriptor.
- [ ] 2.4 The shared build-property layout (`Descriptor`): rows only for set values, byte-stable.

## 3. TwinCAT: tests red (offline, after 1.1)

- [ ] 3.1 A PLC project with define `A` → `.application` at the PLC project node with the `Compiler defines` row; its
      `.projectsettings` has no `Project defines` row.
- [ ] 3.2 Wire parity (`test/shared/WireParityCases.cs`): the same define gives byte-identical descriptor text on both.

## 4. LSP: tests red

- [x] 4.1 `.projectsettings` per project: two PLC projects with different disabled warnings → each project's items get
      their own. Today: the last one read wins (`workspace-refs.ts:186-189`).
- [ ] 4.2 `defined(A)` answered from the item's own application's `.application` (two applications, different defines).
- [ ] 4.3 `project_defined` still answers from the project's defines.

## 5. Implement

- [ ] 5.1 `ItemKind`: the `application` reference kind (`.application`), read-only; regenerate the docs tables
      (`VOLT_WRITE_DOCS=1`); `bun run check` green.
- [ ] 5.2 The shared build-property layout in the descriptor format.
- [ ] 5.3 CODESYS: the walk emits the item; `ContainerRefusal` drops the Application case; the descriptor read.
- [ ] 5.4 TwinCAT: the walk emits the item at the PLC project node; `TcProjectSettings` stops filling `ProjectDefines`.
- [ ] 5.5 LSP: `.application` in `REFERENCE_EXTENSIONS`; defines per application root; settings per project.

## 6. Live and docs

- [ ] 6.1 Live SP21 on a corpus copy with an application define: the item reads it; an IDE edit changes its version.
      Re-pull the corpora: one new file per application with a build property, nothing else changes.
- [ ] 6.2 Live TwinCAT 4024: the item at the PLC project node; an IDE edit changes its version.
- [ ] 6.3 `docs/wire.html` identity examples; DIALECT rows.
