# Design — multi-application-tree

## 1. Identity: the item's path

An item is identified by its PATH in the IDE's own tree: `<folder>/<name>.<kind>`. `Versioning.VersionedItem.Identity`
derives it, in one place. Below the vendor seam the driver still looks an item up by its bare name, but only inside the
container the path names.

**CODESYS — two devices** (`test/fixtures/CodesysTwoDevices.3.5.21.40.project`):

```
Project Settings.projectsettings
Device/Device.device
Device/Plc Logic/Application/PLC_PRG.pou
Device/Plc Logic/Application/Task Configuration/MainTask.task
Device/Plc Logic/Application/Library Manager/IecSfc/IecSfc.library
Device_1/Device_1.device
Device_1/Plc Logic/Application/PLC_PRG.pou
Device_1/Plc Logic/Application/Task Configuration/MainTask.task
```

**TwinCAT — two system projects, four PLC projects** (`test/fixtures/TwinCAT MultiProject/`):

```
TwinCAT Project14/TwinCAT Project14.device
TwinCAT Project14/PLC/Untitled2/PLC_PRG.pou
TwinCAT Project14/PLC/Untitled2/PlcTask.task
TwinCAT Project14/PLC/Untitled2/Project Settings.projectsettings
TwinCAT Project14/PLC/Untitled2/References/Tc2_Standard/Tc2_Standard.library
TwinCAT Project14/PLC/Untitled1/POUs/PLC_PRG.pou
TwinCAT Project14/PLC/Untitled3/POUs/MAIN.pou
TwinCAT Project1/TwinCAT Project1.device
TwinCAT Project1/PLC/Untitled1/POUs/MAIN.pou
```

Each item sits where its IDE keeps it. Neither vendor's tree is reshaped to look like the other's.

- **TwinCAT task.** The `.task` item is the PLC project's task object (`PlcTask.TcTTO`, code 621, the one that holds the
  calls). The IDE keeps it inside the PLC project, so its path is `<system>/PLC/<plc>/PlcTask.task`. It is not under
  `SYSTEM/Tasks`, because the fixture shows that cannot work: `TwinCAT Project14` holds three `PlcTask.TcTTO` (one per
  PLC project) and only two real-time tasks (`PlcTask`, `PlcTask1`), so `SYSTEM/Tasks/PlcTask.task` would be three
  items on one path. (This changes the census default. The owner can override it.)
- The TwinCAT PLC project's inner node (`Untitled2 Project`) is not a path segment. Its children sit directly under
  `<plc>/`, as the census decided.
- `Project Settings.projectsettings` is per project on CODESYS (at the root) and per PLC project on TwinCAT (the
  settings live in the `.plcproj`).

## 2. Containers become read-only descriptors

| Container | CODESYS | TwinCAT | Item |
|---|---|---|---|
| a target (device / system project) | `IDeviceObject` (695) | the system project (`.tsproj`) | `<name>/<name>.device`, read-only, kind `device` |
| an application / PLC project | `IApplicationObject` | the PLC project under `TIPC` | folder only, no item |
| `Plc Logic`, `SYSTEM`, `PLC`, Task Configuration | recurse-only | recurse-only | folder only |

There is one kind on both vendors, `device` (`ItemKind.PlcDevice`, already in `docs/items.html`). This change adds no new
kind or extension. The TwinCAT `.device` describes the target the same way CODESYS's does, as `key: value` lines (its name,
the target platform, the TwinCAT version). Step 3.1 fixes the exact lines, and `DocDataTests` gates them. Volt does not
read MOTION, I/O, SAFETY or C++, and CODESYS carries no hardware either.

## 3. Applications are stated, never guessed

`refs` and `fetch` answer one more field: the root path of every application.

```json
"applications": ["Device/Plc Logic/Application", "Device_1/Plc Logic/Application"]
"applications": ["TwinCAT Project14/PLC/Untitled2", "TwinCAT Project14/PLC/Untitled1",
                 "TwinCAT Project14/PLC/Untitled3", "TwinCAT Project1/PLC/Untitled1"]
```

An item belongs to the application whose root is the longest prefix of its path. An item under no root (the CODESYS
POU pool at the project root) belongs to the pool. A client never parses a vendor segment such as `Plc Logic` or `PLC`.

## 4. What the wire keys become

| Field | Today | After |
|---|---|---|
| `items`, `removed`, `onlyItems`, `knownItems`, push `newItems` | `PLC_PRG.pou` | `Device/Plc Logic/Application/PLC_PRG.pou` |
| `folders`, `knownFolders`, push `newFolders` | name → folder | **deleted** (the path holds the folder) |
| `unreadable[].name` | bare name | `<folder>/<bare name>` (no kind could be read) |
| push op `name`, conflict `name` / `renamedTo` | full name | path |
| push `set` `toName` + `toFolder` | two fields | one field, `to`: the new path |
| build diagnostic `name` | full name | path |
| `projectVersion` | hash over name + version | hash over path + version |

A push resolves `name` by walking to its folder and then looking up the bare name in that container
(`ItemLookup.Find/Locate/Refind`, `PushService.itemCache`). It never searches the whole tree. A path that names no
existing item is a create there, or `IDE_LOST_ITEM` when `ifVersion` is set. One op per path
(`RequireOneOpPerItem`) keys on the path.

The workspace already writes each file at `<folder>/<file>`. On CODESYS its layout does not change. On TwinCAT it gains
the `<system>/PLC/<plc>/` prefix. No migration: Volt has no users yet.

## 5. Moves pair within one application

The CLI pairs a deleted path `A` and an added path `B` into one `set { name: A, to: B }` only when `application(A) ==
application(B)` (§3). Every other pair stays a delete and a create.

```
Device/Plc Logic/Application/POUs/X.pou -> Device/Plc Logic/Application/Lib/X.pou        set {to}  (move)
Device/Plc Logic/Application/X.pou      -> Device_1/Plc Logic/Application/X.pou          delete + create
TwinCAT Project14/PLC/Untitled2/X.pou   -> TwinCAT Project1/PLC/Untitled1/X.pou          delete + create
```

The pool counts as its own application. So a CODESYS move between the pool and an application becomes a delete and a
create. Today that move pairs. This is the one behaviour change in the move rule, and it is listed for the owner.

## 6. Build covers every application

`build` compiles every application. On CODESYS it calls `Build()` on each `IApplicationObject`, where today it calls it
only on `FindApplication()`'s first one. On TwinCAT it compiles each PLC project of each system project, where today it
compiles only `tipc.Child[1]`. A diagnostic carries its item's path, so the same message in two applications is two
diagnostics. CODESYS's library precompile (`Libraries.cs`) runs once per application, because each application has its
own Library Manager. Signatures land under that application's `Library Manager/` path.

## 7. The bound project

On CODESYS, the bound project stays the `.project`. On TwinCAT it becomes the solution (named after the `.sln`), because
one `refs` now holds every system project. Today `health` lists each system project as its own row and serves one of
them. After this change it lists one row per XAE window. (This follows from the owner's "one tree"; it is listed for the
owner.)

## 8. LSP scope

There is one scope per application: its own items, its own libraries, and the pool. A name resolves inside its own
application. The same GVL name in two applications is not a C0136 ambiguity.
