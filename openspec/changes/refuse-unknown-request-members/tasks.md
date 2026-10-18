## 1. Tests red

- [ ] 1.1 `PipeTransportTests`: one theory over (op, member). Each case → `BAD_REQUEST` naming the op and the member, with
      nothing walked or applied. Cases: `fetch` `knownFolders`, `refs` `knownFolders`, `build` `buildType`, `connect` `x`,
      `push` top-level `x`, one miscased member (`fetch` `KnownItems`), and a push op with no discriminator
      (`push {ops:[{name:"X.pou"}]}`). Today: accepted, member dropped; the last is refused later, at dispatch.
- [ ] 1.3 A miscased member on a response (`BridgeClient`) or the envelope (`PipeServer`) is not read. Today: read.
- [ ] 1.2 The existing `toFolder`/`toName` test stays as it is, and stays green after the attributes are deleted.

## 2. Implement

- [ ] 2.1 `WireJson.Request` (case-exact, `UnmappedMemberHandling.Disallow`). `Body<T>` reads with it.
- [ ] 2.2 Delete `[JsonUnmappedMemberHandling]` from `SetItemOp` and `DeleteItemOp`.
- [ ] 2.3 Remove `buildType` from the six senders in `packages/volt-lsp-iec/scripts` (`audit-check.ts:47`, `:67`;
      `conversion-matrix.ts:76`; `record-corpus-build.ts:28`; `record-language.ts:348`; `verify-catalog.ts:181`).
- [ ] 2.4 `PushOp` abstract. `Body<T>` maps whatever `System.Text.Json` raises for the missing discriminator to
      `BAD_REQUEST` (1.1 pins it). Delete the base-type dispatch branch and its `MalformedPushOpTests` case.
- [ ] 2.5 `WireJson.Read`: drop `PropertyNameCaseInsensitive`; delete the `WireJson.cs:8-9` rationale. Correct the
      `PushRequest.ReturnSources` comment.

## 3. Docs

- [ ] 3.1 `DocDataTests.SchemaOf`: `additionalProperties: false` on request object schemas. Regenerate
      `volt-bridge.openrpc.json` (`VOLT_WRITE_DOCS=1`).
- [ ] 3.2 `wire.html` `BAD_REQUEST` row: add "a body member the op does not have". In the same table, drop the history
      remarks "(it was NO_SIDECAR)" and "(INVALID_CODE_HEADER is gone…)".
- [ ] 3.3 `relay-protocol.md:86-87`: an unknown field is ignored on the FRAME only; an unknown body member is
      `BAD_REQUEST`.
