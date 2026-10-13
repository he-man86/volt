## 2.0 — An absent vendor member fails every op (SP18)

**Target.** On CODESYS 3.5.18.30 the library manager's archive does not name `ParameterTable`. `ArchivedObject` throws
`Unreadable` → `GetLibraryRefs` throws → `CodesysDriver.Tree.Walk` has no catch around the manager → the whole walk
fails → every op that walks (refs, fetch, pull, push, lifecycle) fails (212 of 218). Two facts are merged into one throw:
*the version's object model has no such member* and *the member is there but its read failed*. Same pattern at every
`ArchivedObject` / `NwlInterop.Declared` / `Has` site bridge-one-to-one added (Properties, Task, Libraries).

**Choice: a measured availability table, keyed by platform version, and per-item refusal.**
- `MemberAvailability` (Ide.Codesys): rows `(owner type, member, first platform version that has it)`, filled ONLY from
  the census below; the version is `CodesysPlatform`'s (DIALECT V1). A new DIALECT row (V7) is the vendor-fact record;
  a gate test holds the table and the row in step.
- The read asks the table first. **Absent, and the table says this version lacks it** → the fact the member would have
  carried does not exist here: nothing to spell, nothing reported (for `ParameterTable`: no parameter values to name).
- **Absent where the table says it exists, or on a version no census measured** → that ITEM is unreadable with its reason
  (`UnreadableObject`, the existing per-item path), never the op. **Present but the read throws** → same, per item.
- The library manager's read is caught in `Walk` like every other per-item refusal: the manager becomes one
  `UnreadableObject` (no `.library` file is removed — `Removal.IsUnreadable` already holds them), the rest of the walk runs.

**Rejected (one line each).**
- *Absent ⇒ empty (treat a missing member as "no values")* — a fallback: a member renamed on SP22 reads as "nothing
  there" and the loss is silent.
- *Refuse the version at start (V2-style capability)* — refuses all of SP18 for a fact about library parameters; that is
  the regression, made permanent.
- *Infer per object at runtime (absent from this instance's `SerializableValueNames` ⇒ absent from the version)* —
  decided by one measurement: if the archive list can differ between two instances of one type (e.g. omits an empty
  member), absence is not a version fact. Census reads two instances per type (with and without the value); if they
  differ, the table is the only sound key; if constant per type, the table still holds, it just never disagrees.

**Census (the measurement 2.0 runs, decides the table's rows).** One probe per IDE — SP18 3.5.18.30, SP21 3.5.21.40,
SP22 if installed, 32-bit 3.5.21.60 — lists, for every owner type the bridge reads, the FULL `SerializableValueNames` and
the declared properties it reads by `Has`/`Declared`. Diffed per version, a rename shows as one name gone and one new
(never read as absence). Probe deleted after; the numbers live in V7.

**Stays refused by name.** A version not in the census with a member absent (e.g. 3.5.17.20 field) — per item, naming
member, type and version; V2 capabilities (start refusal) unchanged; a present member with an unmeasured value (the
`LibraryConstants`, text-list translations) unchanged; ParameterTable values on versions that HAVE it stay "unspelled".

**Migration.** Red first: a FakeIde library manager whose archive omits `ParameterTable` (absent-by-version → green
walk, no report line) and one on an uncensused version (→ manager unreadable, other items pulled); today both fail the
walk. Then census → table + V7 → route `ArchivedObject`/`Declared`/`LibMember`/`TaskMember` through it → catch in
`Walk`. Done when SP18 e2e fails only the expected LD/FBD write refusals.

**Built (2.0, 2026-10-13) — where reality changed the plan, and why.**
- *Three rows, not one.* The census (DIALECT V7: SP18 3.5.18.30, SP21 3.5.21.40, 32-bit SP21 3.5.21.60, SP22 3.5.22.40;
  every instance in four fixtures plus a fresh instance of each owner type) found 3.5.18.30 without
  `LibManObject.ParameterTable` AND without `TaskConfigObject.StackSize` / `UseConfigurableStackSize` — the Task
  Configuration's `ContainerRefusal` read them too, so on SP18 it was named unreadable and every task under it held back.
  The declared members/methods read by `Has`/`Declared`/`LibMember`/`TaskMember` are identical on all four, so those
  sites were NOT routed through the table (a missing one still refuses its item by name — no version fact to record);
  the table is read only by `Archives` (archive members). Within one platform every instance of a type archives the
  same list (with and without values), so the rejected per-object inference would never have disagreed — the table
  stays the key for the rename reason.
- *Which `.library` files are kept.* `Removal.IsUnreadable` holds items by bare name + kind, and the manager's libraries
  are not known by name when it is unreadable — so the manager is named with a known (container) kind and its OWN folder
  is unwalked (absence beside it still means deleted). That protects the `.library` manifests, not the signature files:
  a fetch whose live library set missed them read them as REMOVED, set `librariesRefreshed`, and the client would have
  dropped every signature file. `FetchService` now refuses to refresh while a known `.library` is unseen (under an
  unwalked folder, or walked and unreadable) — red test `LibrariesRefreshedTests.A_walk_that_could_not_read_the_library_folder…`.
- *The platform reaches the read.* `CodesysObjectModel` takes the platform version (the driver's, DIALECT V1); the
  archive readers became instance methods. A null platform (not read) is no measured one: every absence refuses.
- *Gate 2a: the library-refresh hold is per folder, and SP18 parameter values live on the references.* The hold above
  first fired on ANY unwalked folder; it now asks THE removal rule (`Removal.Removed`), so a library absent from a
  manager the walk read is removed and refreshes as before 2.0. And `ParameterTable`'s absence on 3.5.18.30 turned out
  to be a rename of WHERE, not WHETHER: each reference archives its own `Params` there (moved into the table by later
  versions on load), so on SP18 those are read and named. The rule this adds to the table: a row says the MEMBER is
  absent; the reading site must state where its fact lives instead, or show (from the vendor's own assembly) that it has
  none — as the stack settings, which SP18 does not have under any name.
