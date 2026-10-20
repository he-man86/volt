## 1. Measure

- [ ] 1.1 Live TwinCAT 4024 MultiProject: the call that builds ONE PLC project, its diagnostics scoped to it, and what
      TwinCAT's own "Before building: Save all changes" saves in that case (DIALECT row).

## 2. Tests red

- [ ] 2.1 Transport: `build` with `applications: [root]` builds only that application on both drivers (fakes record which).
- [ ] 2.2 A root that names no application → `BAD_REQUEST` naming it; nothing built.
- [ ] 2.3 Absent `applications` → every application built, as today.

## 3. Implement

- [ ] 3.1 `BuildRequest.Applications`, `BuildService`, both drivers; `volt build --app`.
- [ ] 3.2 OpenRPC, `wire.html`; schema re-pinned at protocol 2 (owner and PLC Assist agree on the release first).
