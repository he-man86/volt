## Model
- [x] `ItemKind.IsContainerManager(code)` — library / recipe / visualization managers are pure containers.

## Walks
- [x] CODESYS `Walk`: container-managers recurse (synthesized library refs / recipe / visualization children
      under a folder named after the manager), emit NO stub item.
- [x] TwinCAT `WalkInner`: generalize the existing library-manager container branch to `IsContainerManager`.

## Core backstop + consistency
- [x] `FetchService` + `RefsService`: skip any container-manager item (vendor-agnostic invariant).
- [x] `FetchService.changed` deduped by full name (matches the name-keyed `Items` map — no orphaned duplicate).

## Tests / verification
- [x] `ContainerManagerTests`: the predicate; a manager is never emitted by fetch/refs; a repeated opaque name
      collapses in `changed` to match `Items`.
- [x] Live: all 5 corpus projects re-fetched clean (no stubs, no root duplicate, libraries intact).
