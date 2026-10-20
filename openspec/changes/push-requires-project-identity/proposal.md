> Protocol-2 release, with `build-selects-application` and `grep-item-sources`. The OpenRPC hash and
> `WireProtocol.Version` are re-pinned once, in that release's final step.

## Why

A write op without its binding writes into whatever project the bridge serves. `OpGuard.RequireBoundProject`
(`Volt.Engine/Sync/OpGuard.cs:25-41`) checks each expectation only when it is SUPPLIED; the comment at `:33` says it:
"Supplying NEITHER runs only the connected check (init/discovery)". `PushService.Handle` (`PushService.cs:36`) and
`BuildService.Handle` call it with the request's two nullable members, so a push that omits `expectedPlatform` and
`expectedProjectName` is applied to the served project, whichever it is.

The volt-cli rework's public-API census found it (`openspec/changes/volt-cli-rework/input/map-and-rating.md`, finding P1,
"Public API: 5 requests our CLI never sends"): "holds only because our CLI is polite: a write op should require its
binding". It was the first of the five. Measured today, the CLI is not the only client: the e2e harness
(`test/e2e/lib/bridge.ts` `push`/`build`, `refusals/table.ts`, `refusals/behaviour-changes.test.ts`) and the vendor-facts
runner (`scripts/vendor-facts.ts` `push`/`build`) send neither, and PLC Assist is a foreign client that reaches the pipe
through the relay.

## What Changes

- **`push` and `build` require both `expectedPlatform` and `expectedProjectName`.** A request that omits one, or sends it
  empty, is refused with `BAD_REQUEST` naming each missing member, before the walk, the apply or the build. The check is
  the guard's own first step (`OpGuard`), so it is one rule in one place for both ops and both vendors; a supplied pair
  is then checked as today (`PLC_DISCONNECTED`, `WRONG_PROJECT`).
- **`build` counts as a write.** On TwinCAT a build saves every changed document of the served solution before it
  compiles, the shell's "Before building: Save all changes" (DIALECT D45, and D46 for a one-project build): a build of the
  wrong project writes that project's unsaved edits to disk. On CODESYS a build replaces the IDE's message view. Both are
  writes to a project the client did not name.
- **Reads stay as they are.** `refs` and `fetch` (`init` included) write nothing, echo the identity they walked
  (`ReadResponse.platform`/`projectName`) so a client confirms it before it merges, and a first `init` or a discovery has
  no binding to send. `connect`/`disconnect` select or pause the session and write no project.
- **Every client of ours sends the binding.** The CLI already does (`Commands.cs`: push, build). volt-control drives the
  CLI and builds no request. The e2e harness and the vendor-facts runner send the identity their `refs` echoed.
- **Wire:** the two members are required on `PushRequest` and `BuildRequest` in the OpenRPC schema (they stay optional on
  `RefsRequest`/`FetchRequest`); `push` lists `BAD_REQUEST` among its error frames; `wire.html` states the rule.

## Impact

A request that was accepted is now refused: an older client that pushes without identity gets `BAD_REQUEST`. It is a
schema change (required members), so it rides the protocol-2 release. PLC Assist must send both members on `push` and
`build`.
