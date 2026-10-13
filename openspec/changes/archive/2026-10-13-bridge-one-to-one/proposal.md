## Why

The owner (2026-10-12) extended the LD/FBD rule to the complete language: **Volt's text is the vendor's object model one
to one for every member that is not a measured editor cache; a member is spelled unless a measurement proves it a cache,
else refused by name — nothing folded, guessed or defaulted.** It closes gaps nobody foresaw and simplifies the code. The
owner: "run a change and workflow for this" — "I don't mind you refactoring or updating the code".

A read-only audit of both drivers and the engine (2026-10-12) found the root cause: **the seam vocabulary cannot carry an
object property.** `ItemContent` / `Member` / `Accessor` (`Volt.Engine/Item/ItemContent.cs:31-136`) hold declaration, body,
members, a member folder and accessors — nothing else. Exclude-from-build, external, link-always, object comments and the
object's CLASS are never read or written on either vendor. Findings, by risk:

1. **Data loss — the class on every create** (DIALECT C2n): a pulled `CheckBounds` (`POUObjectCheckFunction`), an NVL
   (`CAN_TO_PLC`, its `NetVarProperties`), a persistent list, a text-list enum (`IQSlices`) is re-created plain
   (`CodesysObjectModel.Libraries.cs:376-382`; folded on read by `CodesysTypeMap.cs:59/68`) and the push says ACCEPTED;
   CODESYS then calls the check 0 times.
2. **Data loss — a member re-type or rename is delete + create** (`PushService.cs:1993-2013`): an `AbstractPOUMethodObject`
   comes back a `POUMethodObject`, its GUID gone.
3. **Data loss on migration — object properties** never read or written (ARCHITECTURE.md:153 admits exclude-from-build).
4. **A task's external event folded into `Event:`** (`Descriptors.cs:166/257`) — a push moves it; call-list comments
   carried by name but never spelled (`:387/400`); a disabled watchdog's values hidden (`:169`); TwinCAT task type and
   watchdog hard-coded (`TcTaskSchedule.cs:44/62`), other TaskDef members unspelled.
5. **SFC transitions absent from the text** (`ItemKind.cs:338/346`).
6. **A TwinCAT DUT create always seeds 606** (`TcObjectModel.cs:380`) — unmeasured kind change after reload.
7. **Wire divergences** for the same object: stub manifests (`kind\n` vs `Name=X\n`), library `SYSTEM` (TwinCAT hard-codes
   false and guesses namespace/resolution), interface property accessor declarations (TwinCAT emits presence only).
8. **Guesses and fallbacks:** END line → `END_FUNCTION_BLOCK` (`StWriter.cs:85/97`); GET/SET decided by the object's NAME
   (`CodesysTypeMap.cs:161`); missing aspect read as `""` (`CodesysObjectModel.cs:149/172`, `TcObjectModel.cs:503/512`);
   `Guid.Empty` / handle 0 defaults; whitespace body → null; `AbstractMemberFold` (needs its equivalence measured or the
   class spelled).
9. **Cosmetic, each to measure or spell:** trailing newlines trimmed, members re-sorted, sibling order not spelled, empty
   folders, descriptor values flattened/dropped, device name "first that answers".

Docs contradict code (`items.html`, `driver.html`, `wire.html`, ARCHITECTURE.md:142-148/220/225/396 — e.g. "round-trips
are lossless", "both vendors answer identically").

## What Changes

- **The contract carries object properties:** an `ObjectProperties` carrier on `ItemContent` and `Member`; the text spells
  them as `%`-lines beside `%FOLDER` (`%CLASS …`, `%EXCLUDE_FROM_BUILD`, `%EXTERNAL`, `%LINK_ALWAYS`, `%COMMENT "…"`,
  `%NETVAR key: value`, …) — final forms decided by the census and the disposition table.
- **Every member of every item kind decided** — spelled / measured cache / refused by name — default SPELLED; members with
  no corpus occurrence decided too; each vendor fact a `vendor-facts` row.
- **Creates make the pulled class or are refused by name**; member re-types and renames keep the object where the vendor
  allows, else are refused by name.
- **Task descriptors** spell `External event:`, call comments, watchdog values, TwinCAT TaskDef members; **SFC transitions**
  as member blocks; **wire parity** for stub manifests, library SYSTEM, interface accessors.
- **Every fallback in (8) deleted** — refuse or spell instead.
- **A completeness oracle per item kind** (vendor object → text → push into a blank copy → re-read reproduces every
  non-cache member; an undecided member fails by name) and a **wire-parity gate**.
- **Docs regenerated and the prose rewritten** (`packages/volt-cli/docs`: items, driver, wire; ARCHITECTURE.md; DIALECT).

Not in this change: NWL members inside a graphical body (owned by `ld-fbd-coverage` 1b; same rule, table format, probe
and oracle harness). Runs BEFORE `ld-fbd-coverage` (owner 2026-10-12): it rebuilds the item contract and the push/driver
write paths that LD/FBD's per-network push (its 1b.4) builds on; it sets up the vendor-facts rows and the oracle harness,
which LD/FBD then reuses.

## Impact

`packages/volt-cli` (Engine Item/Format/Sync, both drivers, the probe table, docs, ARCHITECTURE.md, DIALECT.md), the LSP
where the text gains `%`-lines (`frontend/syntax/format`), `volt-control` if it reads item text. A format extension: a
re-pull adds the new lines to the files that carry such properties. New spellings listed for the owner in the close report.
