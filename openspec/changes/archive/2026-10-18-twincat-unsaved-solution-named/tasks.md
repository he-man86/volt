## 1. Measure (gates everything below)

- [x] 1.1 Live, TwinCAT 4024 XAE (2026-10-18, own instance, DIALECT D44): File > Open > Project on a `.tsproj` a `.sln`
      above holds opens that solution. On one no `.sln` holds: `IsOpen` true, `FullName` empty,
      `Properties.Item("Name")` = `TwinCAT Project14`, one project; `health` had no row and `refs`/`connect` answered
      `PLC_DISCONNECTED` "waiting for an IDE project" / "no such project open". A saved `.sln`: stated name = file name.
      `File.SaveAll` on the temporary solution opened a modal "Save File As" and did not return (40 s) → **option B**.
- [ ] 1.2 CODESYS SP21: File > New Project, before any save. NOT MEASURED in this run (left open; a gap there is its own
      change).

## 2. Tests red

- [x] 2.1 TwinCAT offline (`TcUnsavedSolutionTests`, the window double with `Unsaved`): one system project, empty
      `FullName` → no `health` row; `refs` answers `PLC_DISCONNECTED` naming the cause ("solution is not saved") and the
      remedy ("File > Save All"). Red before: "Bridge is waiting for an IDE project".
- [x] 2.2 Pin: a saved solution keeps its row named after its `.sln` (`TcAttachTests`).

## 3. Implement

- [x] 3.1 `IIdeSession.NotServedBecause` (null on CODESYS); TwinCAT answers it from `TcObjectModel.NotServedBecause`
      (empty `FullName`, a TwinCAT system project open). `OpGuard` and `connect`'s refusal carry it in `PLC_DISCONNECTED`.
      No new status, field or code.

## 4. Docs

- [x] 4.1 `DIALECT.md` D44 with 1.1's measurements; `wire.html` `PLC_DISCONNECTED` row.
