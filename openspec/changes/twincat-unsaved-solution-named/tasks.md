## 1. Measure (gates everything below)

- [ ] 1.1 Live, TwinCAT 4024 XAE: File > Open > Project on a `.tsproj`. Record `Solution.IsOpen`, `FullName`,
      `Properties.Item("Name").Value`, each project's `Name`, and today's `health` and `refs` answers. Repeat after
      File > Save All, and on an ordinary saved `.sln` (stated name vs file name). Record in `DIALECT.md`.
      - Empty `FullName` never occurs → close the change with that DIALECT note, no code.
      - Stated name readable and non-empty → sections 2-4 as written.
      - Stated name empty or unreadable → rewrite spec and tasks to the cause-naming `PLC_DISCONNECTED` message (design,
        option B) before section 2.
- [ ] 1.2 CODESYS SP21: File > New Project, before any save. Does it get a row and a sync? Record it; a gap there is its
      own change.

## 2. Tests red

- [ ] 2.1 TwinCAT offline (DTE double split into `Name` and `FullName`): open solution, empty `FullName`, stated name
      `TwinCAT Project14`, one system project → one `health` row `TwinCAT Project14`, status `idle`; `connect` to it binds
      and `refs` answers. Today: no row, `PLC_DISCONNECTED`.
- [ ] 2.2 Pin: saved solution `Lift.sln` → row `Lift`, as today.

## 3. Implement

- [ ] 3.1 `SolutionName()` reads `Solution.Properties.Item("Name")`, one source; an unreadable read keeps today's Warn
      and no row.

## 4. Docs

- [ ] 4.1 `DIALECT.md`: the solution's name is the one XAE states (with 1.1's numbers).
