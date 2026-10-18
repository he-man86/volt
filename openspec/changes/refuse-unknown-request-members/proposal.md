> One wire release with `relay-protocol-tracks-wire-breaks` (which carries the shared tasks: protocol 2, the schema pin)
> and `unreadable-name-carries-kind`. Apply this change before the relay change re-pins the schema.

## Why

Request bodies drop members they do not define. Every op body is read in one place, `BridgePipeHost.Body<T>`
(`packages/volt-cli/src/Volt.Engine.Host/BridgePipeHost.cs:230`; called for `connect` `:126`, `refs` `:166`, `fetch`
`:168`, `push` `:170`, `build` `:172`), with `WireJson.Read` (`src/Volt.Contracts/Wire/WireJson.cs:29-32`), which sets only
`PropertyNameCaseInsensitive`. Unmapped members are skipped. Only `SetItemOp` and `DeleteItemOp` refuse them, through
their own `[JsonUnmappedMemberHandling(Disallow)]` (`PushModels.cs:55`, `:68`).

Measured costs:

- **A folder-wire client loses data on a path-wire bridge.** The old wire sent `knownFolders` on `refs`/`fetch`. It is
  dropped, no `knownApplications` arrives, and the old client's file-name keys (`X.pou`) read as root paths. On a complete
  walk every known item that is not at the root lands in `removed` (`src/Volt.Engine/Sync/Removal.cs:44`, `:50`, `:60-63`).
  The call succeeds, and the pull deletes the files.
- **Volt's own senders drift unseen.** Six LSP recorder scripts still send `build { buildType }`, a member deleted on
  2026-08-27 (`packages/volt-lsp-iec/scripts/audit-check.ts:47`, `:67`; `conversion-matrix.ts:76`;
  `record-corpus-build.ts:28`; `record-language.ts:348`; `verify-catalog.ts:181`). The bridge drops it without a word.
- **The published schema understates strictness.** `docs/volt-bridge.openrpc.json` declares no
  `additionalProperties: false` on any request object, not even on the two strict op types.

Case-insensitive member reading has no request sender: every DTO declares `[JsonPropertyName]`, and a search for
PascalCase request members across TS and C# senders finds 0 hits and 0 pins.

## What Changes

- **One strict request read.** `WireJson.Request`: case-exact, `UnmappedMemberHandling = Disallow`. `Body<T>` uses it, so
  every request body (top level and each push op) refuses an unknown or miscased member by construction. The existing
  wrapper already answers `BAD_REQUEST` "the body of `<op>` is not a valid `<Type>`: The JSON property '`<member>`' could
  not be mapped…", which names the op and the member. No new message code.
- The two per-type attributes on `SetItemOp`/`DeleteItemOp` are deleted: one mechanism.
- **`PushOp` becomes abstract.** A push op with no `op` discriminator is refused by the same read as `BAD_REQUEST`, instead
  of being read as a plain `PushOp` and refused later by a separate dispatch branch (`MalformedPushOpTests.cs:28-41`),
  which is deleted with its test.
- **`WireJson.Read` (envelope and responses) becomes case-exact too.** Its one reason, "a client that predates
  `[JsonPropertyName]` may still be sending PascalCase" (`WireJson.cs:8-9`), is the same 0-sender compat. It keeps only
  unknown-member leniency, which the relay change's bump rule relies on.
- The six `buildType` senders stop sending it.
- The OpenRPC generator emits `additionalProperties: false` on request object schemas.
- Docs: `wire.html`'s `BAD_REQUEST` row gains "a body member the op does not have". `relay-protocol.md`'s "a request field
  the bridge does not know is ignored" is narrowed to frame fields. The `PushRequest.ReturnSources` comment ("an older
  bridge ignores it") is corrected.

## Impact

- `Volt.Contracts/Wire/WireJson.cs`, `PushModels.cs`; `Volt.Engine.Host/BridgePipeHost.cs` (`Body<T>`), `PushService`
  (the base-type dispatch branch).
- `test/Volt.Engine.Tests/docs/DocDataTests.cs` (schema generator), `docs/volt-bridge.openrpc.json`, `docs/wire.html`,
  `docs/relay-protocol.md`.
- `packages/volt-lsp-iec/scripts/` (six call sites).
- Tests: `PipeTransportTests`, `MalformedPushOpTests` (the base-type case is deleted).
