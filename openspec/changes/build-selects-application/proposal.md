> Owner, 2026-10-20. Not started: wanted for later, when a large multi-application project or PLC Assist needs it.

## Why

`volt build` compiles every application: CODESYS builds each Application in turn (`CodesysDriver.Build`), TwinCAT
builds the whole solution. On a project with several devices or PLC projects, an engineer working in one application
waits for all of them and reads every application's diagnostics.

## What Changes

- `build` takes an optional `applications` list: the roots, as `refs`/`fetch` publish them in `applications`, of the
  applications to compile. Absent, every application is built, as today.
- A root that names no application is refused by name (`BAD_REQUEST`), before anything is built.
- CODESYS builds only the named Applications. TwinCAT builds only the named PLC projects (measure first: the
  `SolutionBuild` / `BuildProject` route that compiles one PLC project of a MultiProject solution).
- `volt build --app <root>` (repeatable) on the CLI.

## Impact

A new request member. Request bodies are strict, so an older bridge refuses it, and the OpenRPC schema hash changes:
the protocol number stays 1 (owner, 2026-10-20); the schema hash is re-pinned as protocol 1, in the release's final step, coordinated with PLC Assist.
