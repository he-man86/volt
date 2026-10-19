## 1. Measure (live, own fixture XAE)

- [x] 1.1 Which nodes publish `Exclude` (item, folder, method, action, property, interface, interface property), its
      `readonly` under an excluded folder and in an excluded POU, the `ConsumeXml` that sets it, what a save writes
      (`<Compile>`, `<Folder>`, `<SubObject>`). DIALECT C39.

## 2. Tests red (offline)

- [x] 2.1 TwinCAT: an unsaved exclusion pulls `%EXCLUDE_FROM_BUILD`, in the CODESYS text (`WireParityCases.ExcludedFunctionBlock`).
- [x] 2.2 TwinCAT: a re-included item (`ExcludeFromBuild false` saved, or `true` saved and re-included live) pulls as built.
- [x] 2.3 TwinCAT: an excluded folder answers `WireParityCases.ExcludedFolderEntries`, the CODESYS walk too.
- [x] 2.4 TwinCAT: a member's own flag pulls; an inherited one does not; the push writes item and member flags and reads
      them back; a line on both a POU and its member is refused before any write. (`TcExclusionTests`.)

## 3. Implement

- [x] 3.1 `TcObjectModel.Exclusion` / `WriteExclusion`; `SavedFacts` carries it; the `.plcproj` no longer refuses
      `<ExcludeFromBuild>`.
- [x] 3.2 `ReadProperties` / `ReadMember` spell the own flag; `ValidateProperties` admits it; `WriteContent` writes it.
- [x] 3.3 `ExcludedFolder` (Engine) worded once; both walks use it; the TwinCAT walk reads folder exclusion live.

## 4. Docs and live check

- [x] 4.1 DIALECT C39, `docs/items.html`, `docs/wire.html`, `docs/logs.html`: the current implementation.
- [x] 4.2 Live on MultiProject: item and folder excluded saved and unsaved, a re-included item, `refs`/`fetch`;
      full e2e TwinCAT MultiProject green.
