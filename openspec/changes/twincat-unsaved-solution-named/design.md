## Decision

Read the solution's name from the one place XAE states it (`Solution.Properties.Item("Name")`), not from the `.sln`
file. Gated on task 1.1: the trigger is unmeasured on XAE. Option B instead if the stated name is unreadable on a
temporary solution, OR if a push or build through the bridge on it raises a dialog: both run `File.SaveAll`
(`TcObjectModel.Build.cs:50`), which on a solution with no file may open Save As, and a modal dialog blocks COM (the
push hangs instead of failing loud). That risk is why `SolutionName()` keeps such a window rowless today
(`TcObjectModel.Session.cs:177-178`). If the state never occurs, close with a DIALECT note.

## Options considered

| Option | Wire | Verdict |
|---|---|---|
| A. An `unsaved` row named after the first system project, a `reason` member, `SOLUTION_UNSAVED` | New status, optional field, new code | Rejected (below). |
| B. Keep the window rowless; `PLC_DISCONNECTED` names the cause | Message text only | Fallback, if 1.1 finds the stated name unreadable or `File.SaveAll` raising a dialog. Fixes the message, not the invisible window. |
| **C. Name the solution by what XAE states** | None: an ordinary row | **Chosen**, if 1.1 confirms a readable name and no dialog on push/build |

## Measurements

- One producer of the state: `SolutionName()` (`TcObjectModel.Session.cs:179-190`), feeding `OwnSolution` (`:174`),
  `FindTwinCatProject` (`:269`) and an attach warning (`:123`). Nothing else reads `Solution.FullName`.
- Cases: 0 measured. Every `ide.ps1`/e2e path opens a `.sln`; the offline double has an empty `FullName` only with zero
  projects. Hence task 1.1 gates the change.
- Regression scope: before `7472e6862e` the bridge named rows after system projects and never read `FullName`; that
  commit is in no released tag (latest 0.1.17689).
- Option A's "additive" claim is false in Volt's own code: every non-idle row reads as serving
  (`HealthResponse.cs:79` `ServingProject`, `DetectedProject.cs:34`, `ControlServer.cs:26`), `DriverBase.OverlayLiveHealth`
  (`DriverBase.cs:288`) rewrites a non-idle row to the live verdict (`healthy`), and the CLI would bind the workspace to
  the stand-in name (`Commands.cs:39`, `Config.cs:85`). About 10 C#/TS consumers switch on status.

## Cut, and the rule that cut it

- **The `unsaved` status and `ProjectEntry.Reason`.** An optional field meaningful for one status, breaking
  "non-idle = serving" at ~10 sites. Rule: no bag of optional fields; one way to say each fact.
- **`SOLUTION_UNSAVED`.** Under C the state does not exist; under B a client acts as on `PLC_DISCONNECTED`. Rule: one way
  to say each fact.
- **The row name "first TwinCAT system project".** A guessed stand-in identity. Rule: no fallbacks, no guessing.
- **Hunting other empty-`FullName` triggers, and the throw-path pin.** No measured trigger; the throw is existing,
  Warn-logged behaviour. Rule: measured cases only.
- **Tray rendering and the status table.** Nothing new to render.

## Protocol

No bump: no member, value or meaning changes. A TwinCAT-only behaviour that leaves the wire identical on both vendors.
