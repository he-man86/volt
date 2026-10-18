> Answers the PLC Assist finding: a TwinCAT window whose solution has no `.sln` gets no `health` row and answers
> `PLC_DISCONNECTED`.
>
> Standalone. No wire shape or meaning changes, so no protocol bump. Gated on a live measurement (task 1.1): if XAE never
> holds the state, the change closes with a DIALECT note and no code.

## Why

`multi-application-tree` made TwinCAT bind the SOLUTION, named after its `.sln` file. A window whose solution has no
file disappears with no reason a client can show:

- `TcObjectModel.SolutionName()` returns null when `DTE.Solution.FullName` is empty
  (`packages/volt-cli/src/Volt.Ide.Twincat/Ide/TcObjectModel.Session.cs:179-190`).
- `OwnSolution()` then returns an empty project list (`:174`), so `BeckhoffDriver.BuildProjects()`
  (`Driver/BeckhoffDriver.cs:182-200`) gives the window no `health` row: the tray and every frontend see nothing.
- `FindTwinCatProject` logs the miss at Debug (`:275`) and stays unbound. `refs`/`fetch` answer `PLC_DISCONNECTED` "Bridge
  is waiting for an IDE project" (`src/Volt.Engine/BridgeException.cs:30-31`); `connect` answers "could not attach"
  (`src/Volt.Engine.Host/BridgePipeHost.cs:149-154`). Both are wrong: the project is open in front of the user.

The root is the name source: the bridge derives the solution's name from its FILE, while XAE shows the solution's own
name. Before `multi-application-tree` (not yet released; last release 0.1.17689) such a window synced.

How a user gets there is NOT yet measured: in a Visual Studio shell, File > Open > Project on a `.tsproj` gives a
temporary solution with no file. Task 1.1 measures it on XAE 4024.

## What Changes

- **The solution's name is the name XAE states**: `DTE.Solution.Properties.Item("Name")`, what Solution Explorer shows.
  `SolutionName()` reads that one source and no longer derives the name from `FullName`. A saved solution's stated name
  equals its `.sln` file name (measured in 1.1). A temporary solution has the name VS gives it, so the window serves as an
  ordinary row, as it did before `multi-application-tree`. Saving under another name is a rename, which the connector
  already shows as a rebind row.
- If 1.1 measures that the stated name is empty or unreadable on a temporary solution, or that `File.SaveAll` (run by
  every TwinCAT push and build, `TcObjectModel.Build.cs:50`) raises a Save As dialog on it, this change instead keeps the
  window rowless and makes the existing `PLC_DISCONNECTED` refusal say the cause ("This TwinCAT window's solution is not
  saved; save it (File > Save All) to sync it."). The spec and tasks are rewritten to that before implementing.
- No new row status, field or error code.

## Impact

- `Volt.Ide.Twincat/Ide/TcObjectModel.Session.cs` (`SolutionName`), the offline DTE double (`TcAttachTests`).
- `DIALECT.md`: the measured facts of 1.1.
