## ADDED Requirements

### Requirement: a read op reports its walk
`refs` and `fetch` SHALL send one progress frame per application as the walk finishes it, before any item frame:
`operation` the op, `phase` `"walking"`, `done` the applications walked so far, `total` the applications the walk will
walk (TwinCAT: its PLC projects), or no `total` where the vendor learns its applications as it walks (CODESYS). The item
frames SHALL follow as before (`phase` `"reading"` with `done` 0 and the item total, then one every 25 items and one at
the last).

#### Scenario: an 18-PLC-project solution
- **WHEN** a client sends `refs` to a TwinCAT bridge serving a solution of 18 PLC projects
- **THEN** it receives 18 frames `{"operation":"refs","phase":"walking","done":k,"total":18}` for k = 1…18, then the
  item frames, then the result

### Requirement: a refs joins the identical refs running
A `refs` that arrives while a `refs` with the same body is running SHALL NOT start another walk: it SHALL receive the
running one's progress frames from the moment it arrived and the same terminal frame, result or error. Nothing SHALL
outlive the running `refs`: a `refs` that arrives after it answered walks the project again. A `refs` with another body
SHALL run on its own.

#### Scenario: a retry while the first refs runs
- **WHEN** a caller sends `refs`, gives up, and sends the same `refs` again while the first still runs
- **THEN** the project is walked once, both calls answer the same bytes, and a third `refs` after both answered walks again

### Requirement: the relay heartbeat does not wait for the IDE
The bridge SHALL keep sending its relay ping every 25 s while any number of relayed requests wait for the IDE: each
relayed request's pipe call SHALL hold a thread of its own, never a shared pool thread.

#### Scenario: retried refs held behind a long walk
- **WHEN** many relayed `refs` wait behind a walk that holds the IDE's thread
- **THEN** pings keep their cadence

### Requirement: a refs states where its time went
Every `refs` SHALL log one Info line naming its item count, its total time, the walk's time with the vendor's walk
phases (TwinCAT: the Solution Explorer reads, the I/O devices) and each application's walk time, and the materialize
time with its item count, the compiler-settings items' time and each application's materialize time. A `refs` that
fails SHALL log a Warn line naming what it was doing — walking (after which application), or materializing which item.

#### Scenario: the field log of a slow refs
- **WHEN** a `refs` on a large solution answers
- **THEN** the bridge log holds one `refs: N items in T ms — walk …, materialize …` line

### Requirement: a hierarchy item id is read as the DWORD it is
The TwinCAT bridge SHALL read a Solution Explorer item id answered as any integer VARIANT — `Int32`, `UInt32`, `Int64`
sign- or zero-extended, `Int16`, `UInt16`, `SByte`, `Byte` — as its 32-bit value; an `Int64` outside the DWORD range or
a non-integer SHALL be refused by name, never truncated.

#### Scenario: a pointer-valued id above 2 GB
- **WHEN** the hierarchy answers `VSHPROPID_NextVisibleSibling` as the `Int64` -2
- **THEN** the reader reads item id `0xFFFFFFFE`, and no `OverflowException` is thrown

### Requirement: the Solution Explorer is read for the PLC projects only
The TwinCAT bridge SHALL read, of a system project's Solution Explorer hierarchy, the `PLC` node (canonical `TIPC`) and
below each PLC project item its project node; every other node of the system project (SYSTEM, MOTION, I/O, the PLC
project's instance) SHALL be listed without its children. The solution's project hierarchies SHALL be enumerated at
most once per operation. The C2i snapshot of every PLC project SHALL be what the whole hierarchy gives.

#### Scenario: a plant with a large I/O tree
- **WHEN** a `refs` reads a system project whose I/O tree holds thousands of nodes
- **THEN** no node of the I/O tree is asked for its children

### Requirement: the declarations index comes from the operation's walk
On TwinCAT the index of top-level items a graphical body resolves names against SHALL be the operation's own walk when
that walk read every folder and no structural write (create, delete, rename, move, member placement) followed it — the
same items in the same order as a walk of the tree, the first item of a name winning; otherwise the tree SHALL be walked
for it.

#### Scenario: a fetch that reads an LD body
- **WHEN** a fetch walks the solution and then writes an LD body's network text
- **THEN** resolving the body's names asks the IDE no further tree read

### Requirement: TwinCAT reads its build properties from the IDE's live properties
The TwinCAT bridge SHALL read an item's and a member's `LinkAlways`, `External` and `CompilerDefines` from the node's live
VSProperties, saved or not, and SHALL pull them as `%LINK_ALWAYS`, `%EXTERNAL` and `%COMPILER_DEFINES`, byte-identical to
the text CODESYS pulls for the same object. It SHALL NOT decide them from the saved `.plcproj`, and a push SHALL write each
one back through the IDE and read it back.

#### Scenario: a GVL saved with LinkAlways
- **WHEN** a GVL's `.plcproj` entry holds `<LinkAlways>true</LinkAlways>` and the IDE's `LinkAlways` is `True`
- **THEN** the GVL is pulled, its text closing with `%LINK_ALWAYS`, and it is not in `unreadable`

#### Scenario: a property not yet saved
- **WHEN** `LinkAlways` is set or cleared in the IDE and the project is not saved
- **THEN** the pull follows the IDE, not the saved entry

#### Scenario: a pushed property
- **WHEN** a push adds or removes `%LINK_ALWAYS`, `%EXTERNAL` or `%COMPILER_DEFINES` on an item or a member
- **THEN** the IDE's own property is set or cleared, and a pull reads the same text back

#### Scenario: a build property with no line
- **WHEN** a POU's `AdditionalAllocation` is not 0, or a push carries `%ENABLE_SYSTEM_CALL`, `%ONLINE_CHANGE_RESERVE` or `%UNDEFINE`
- **THEN** the object or the push is refused by name, never pulled or written without it
